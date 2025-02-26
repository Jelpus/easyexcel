const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

const batchSize = 500; // Número de filas por lote para archivos grandes

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        // Responde rápido para evitar timeout en Render
        res.json({ message: "Procesando archivo, consulta en 10s.", status: "processing" });

        // Procesa el archivo en segundo plano
        processFile(fileUrl);

    } catch (error) {
        res.status(500).json({ error: "Error al iniciar el procesamiento.", details: error.message });
    }
});

async function processFile(fileUrl) {
    try {
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // Descargar el archivo sin bloquear la memoria
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name);
                const sheets = workbook.SheetNames;

                if (sheets.length === 0) {
                    console.error("El archivo Excel no contiene hojas.");
                    return;
                }

                const selectedSheet = sheets[0]; // Primera hoja automáticamente
                const sheet = workbook.Sheets[selectedSheet];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                // Si el archivo tiene menos de `batchSize` filas, procesar todo de una vez
                if (jsonData.length <= batchSize) {
                    console.log("Archivo procesado:", { sheet: selectedSheet, totalRows: jsonData.length });
                    return;
                }

                // Si hay más datos, procesarlos por lotes
                console.log("Archivo grande detectado, procesando por lotes...");
                processPaginated(fileUrl, selectedSheet, jsonData);

            } catch (error) {
                console.error("Error al leer el archivo:", error.message);
            } finally {
                tempFile.removeCallback();
            }
        });

    } catch (error) {
        console.error("Error en la descarga del archivo:", error.message);
    }
}

async function processPaginated(fileUrl, sheetName, jsonData) {
    const totalRows = jsonData.length;
    let offset = 0;

    while (offset < totalRows) {
        const paginatedData = jsonData.slice(offset, offset + batchSize);
        const hasNextPage = (offset + batchSize) < totalRows;

        console.log({
            sheet: sheetName,
            totalRows,
            batchSize,
            hasNextPage,
            nextPage: hasNextPage ? `/convert?fileUrl=${encodeURIComponent(fileUrl)}&offset=${offset + batchSize}` : null,
            data: paginatedData.length
        });

        offset += batchSize;
    }
}

// **Ruta para continuar la paginación**
app.get("/convert", async (req, res) => {
    try {
        const { fileUrl, offset = 0 } = req.query;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // Descargar el archivo sin bloquear la memoria
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name);
                const selectedSheet = workbook.SheetNames[0]; // Primera hoja automáticamente
                const sheet = workbook.Sheets[selectedSheet];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                const startIndex = parseInt(offset);
                const paginatedData = jsonData.slice(startIndex, startIndex + batchSize);
                const hasNextPage = (startIndex + batchSize) < jsonData.length;

                res.json({
                    sheet: selectedSheet,
                    totalRows: jsonData.length,
                    batchSize,
                    hasNextPage,
                    nextPage: hasNextPage ? `/convert?fileUrl=${encodeURIComponent(fileUrl)}&offset=${startIndex + batchSize}` : null,
                    data: paginatedData,
                });

            } catch (error) {
                res.status(500).json({ error: "Error al procesar el archivo.", details: error.message });
            } finally {
                tempFile.removeCallback();
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Error en la descarga del archivo.", details: error.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API funcionando en el puerto ${PORT}`));
