const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

const batchSize = 500; // Número de filas por lote
const processedFiles = {}; // Memoria temporal para almacenar resultados

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        const jobId = Date.now().toString(); // Generar un ID único
        processedFiles[jobId] = { status: "processing" };

        // 🔹 Responder rápido para evitar timeout
        res.json({ message: "Procesando archivo, consulta en 10s.", jobId });

        processFile(fileUrl, jobId); // Ejecutar procesamiento en segundo plano

    } catch (error) {
        res.status(500).json({ error: "Error al iniciar el procesamiento.", details: error.message });
    }
});

async function processFile(fileUrl, jobId) {
    try {
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // 🔹 Descargar el archivo sin cargarlo en memoria
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name, { dense: true });
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
                    hasNextPage: jsonData.length > batchSize,
                    nextPage: jsonData.length > batchSize ? `/result/${jobId}?offset=${batchSize}` : null,
                    data: jsonData.slice(0, batchSize),
                };

                console.log(`✅ Archivo procesado: ${jobId}`);

            } catch (error) {
                processedFiles[jobId] = { error: "Error procesando el archivo.", details: error.message };
            } finally {
                tempFile.removeCallback();
            }
        });

    } catch (error) {
        processedFiles[jobId] = { error: "Error en la descarga del archivo.", details: error.message };
    }
}

// 🔹 Consultar resultado después de 10s
app.get("/result/:jobId", (req, res) => {
    const { jobId } = req.params;
    if (!processedFiles[jobId]) {
        return res.status(404).json({ error: "Archivo no encontrado o aún en proceso." });
    }
    res.json(processedFiles[jobId]);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API funcionando en el puerto ${PORT}`));
