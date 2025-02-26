const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const batchSize = 500; // Tamaño de paginación
const cache = {}; // Memoria temporal para almacenar los resultados

// 🔹 Procesar Excel en Segundo Plano
async function processFile(fileUrl, jobId) {
    try {
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name);
                const sheets = workbook.SheetNames;

                if (sheets.length === 0) {
                    cache[jobId] = { error: "El archivo no contiene hojas válidas." };
                    return;
                }

                const selectedSheet = sheets[0];
                const sheet = workbook.Sheets[selectedSheet];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                // Guardar resultado en memoria
                cache[jobId] = {
                    sheet: selectedSheet,
                    totalRows: jsonData.length,
                    data: jsonData.length <= batchSize ? jsonData : jsonData.slice(0, batchSize),
                    hasNextPage: jsonData.length > batchSize,
                    nextPage: jsonData.length > batchSize ? `/result/${jobId}?offset=${batchSize}` : null,
                };

                console.log(`✅ Archivo procesado: ${jobId}`);

            } catch (error) {
                cache[jobId] = { error: "Error procesando el archivo.", details: error.message };
            } finally {
                tempFile.removeCallback();
            }
        });

    } catch (error) {
        cache[jobId] = { error: "Error en la descarga del archivo.", details: error.message };
    }
}

// 🔹 Iniciar Conversión
app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        // Generar un ID único para el proceso
        const jobId = crypto.randomUUID();
        cache[jobId] = { status: "processing" };

        // Procesar en segundo plano
        processFile(fileUrl, jobId);

        res.json({ message: "Procesando archivo, consulta en 10s.", jobId });

    } catch (error) {
        res.status(500).json({ error: "Error al iniciar el procesamiento.", details: error.message });
    }
});

// 🔹 Obtener Resultado del Procesamiento
app.get("/result/:jobId", async (req, res) => {
    const { jobId } = req.params;

    if (!cache[jobId]) {
        return res.status(404).json({ error: "No existe este jobId o aún no se ha procesado." });
    }

    res.json(cache[jobId]);
});

// 🔹 Continuar la Paginación
app.get("/result/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const { offset = 0 } = req.query;
    
    if (!cache[jobId] || cache[jobId].status === "processing") {
        return res.status(404).json({ error: "El archivo aún no está listo." });
    }

    const jsonData = cache[jobId].data;
    const startIndex = parseInt(offset);
    const paginatedData = jsonData.slice(startIndex, startIndex + batchSize);
    const hasNextPage = (startIndex + batchSize) < jsonData.length;

    res.json({
        sheet: cache[jobId].sheet,
        totalRows: jsonData.length,
        batchSize,
        hasNextPage,
        nextPage: hasNextPage ? `/result/${jobId}?offset=${startIndex + batchSize}` : null,
        data: paginatedData,
    });
});

// 🔹 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API funcionando en el puerto ${PORT}`));
