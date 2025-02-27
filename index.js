const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

const batchSize = 500; // Número de filas por lote
const fileSizeLimit = 5 * 1024 * 1024; // 5MB en bytes
const processedFiles = {}; // Memoria temporal para almacenar resultados

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // Descargar el archivo y verificar su tamaño
        const response = await axios.get(fileUrl, { responseType: "stream" });

        let fileSize = 0;
        response.data.on("data", chunk => fileSize += chunk.length);

        const writer = fs.createWriteStream(tempFile.name);
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                if (fileSize <= fileSizeLimit) {
                    // 📌 Archivos pequeños, responder inmediatamente
                    console.log(`✅ Archivo pequeño (${(fileSize / 1024 / 1024).toFixed(2)}MB), respondiendo de inmediato.`);
                    
                    const workbook = xlsx.readFile(tempFile.name, { dense: true });
                    const sheets = workbook.SheetNames;
                    if (sheets.length === 0) {
                        return res.status(400).json({ error: "El archivo Excel no contiene hojas válidas." });
                    }

                    const selectedSheet = sheets[0];
                    const sheet = workbook.Sheets[selectedSheet];

                    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                    if (rawData.length < 2) {
                        return res.status(400).json({ error: "El archivo no contiene datos suficientes." });
                    }

                    const headers = rawData[0];
                    const jsonData = rawData.slice(1).map(row => {
                        return headers.reduce((obj, header, index) => {
                            obj[header || `Column${index + 1}`] = row[index] || null;
                            return obj;
                        }, {});
                    });

                    return res.json({
                        sheet: selectedSheet,
                        totalRows: jsonData.length,
                        batchSize,
                        hasNextPage: false,
                        data: jsonData
                    });
                }

                // 📌 Si el archivo es grande, usar paginación con `jobId`
                const jobId = Date.now().toString();
                processedFiles[jobId] = { status: "processing" };
                res.json({ message: "Procesando archivo, consulta en 10s.", jobId });

                processFile(tempFile.name, jobId);

            } catch (error) {
                res.status(500).json({ error: "Error procesando el archivo.", details: error.message });
            } finally {
                tempFile.removeCallback();
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Error en la descarga del archivo.", details: error.message });
    }
});

async function processFile(filePath, jobId) {
    try {
        const workbook = xlsx.readFile(filePath, { dense: true });
        const sheets = workbook.SheetNames;
        if (sheets.length === 0) {
            processedFiles[jobId] = { error: "El archivo no contiene hojas válidas." };
            return;
        }

        const selectedSheet = sheets[0];
        const sheet = workbook.Sheets[selectedSheet];
        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (rawData.length < 2) {
            processedFiles[jobId] = { error: "El archivo no contiene datos suficientes." };
            return;
        }

        const headers = rawData[0];
        const jsonData = rawData.slice(1).map(row => {
            return headers.reduce((obj, header, index) => {
                obj[header || `Column${index + 1}`] = row[index] || null;
                return obj;
            }, {});
        });

        processedFiles[jobId] = {
            sheet: selectedSheet,
            totalRows: jsonData.length,
            batchSize,
            data: jsonData
        };

        console.log(`✅ Archivo procesado: ${jobId}, ${jsonData.length} filas.`);

    } catch (error) {
        processedFiles[jobId] = { error: "Error procesando el archivo.", details: error.message };
    }
}

// 🔹 Obtener datos paginados
app.get("/result/:jobId", (req, res) => {
    const { jobId } = req.params;
    const offset = parseInt(req.query.offset) || 0;

    if (!processedFiles[jobId]) {
        return res.status(404).json({ error: "Archivo no encontrado o aún en proceso." });
    }

    const jobData = processedFiles[jobId];
    if (jobData.error) {
        return res.status(500).json(jobData);
    }

    const totalRows = jobData.totalRows;
    const dataSlice = jobData.data.slice(offset, offset + batchSize);

    res.json({
        sheet: jobData.sheet,
        totalRows,
        batchSize,
        hasNextPage: offset + batchSize < totalRows,
        nextPage: offset + batchSize < totalRows ? `/result/${jobId}?offset=${offset + batchSize}` : null,
        data: dataSlice
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 API funcionando en el puerto ${PORT}`));
