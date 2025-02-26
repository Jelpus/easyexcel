const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        const batchSize = 500; // Número de filas por lote

        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        // Crear un archivo temporal para almacenar el Excel descargado
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // Descargar el archivo sin cargarlo en memoria
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                // Leer el archivo en modo eficiente
                const workbook = xlsx.readFile(tempFile.name);
                const sheets = workbook.SheetNames;

                if (sheets.length === 0) {
                    return res.status(400).json({ error: "El archivo Excel no contiene hojas." });
                }

                const selectedSheet = sheets[0]; // Toma la primera hoja automáticamente
                const sheet = workbook.Sheets[selectedSheet];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                // Si el archivo tiene menos de `batchSize` filas, devolver todo sin paginación
                if (jsonData.length <= batchSize) {
                    return res.json({ 
                        sheet: selectedSheet, 
                        totalRows: jsonData.length, 
                        hasNextPage: false,
                        data: jsonData 
                    });
                }

                // Si hay más filas, devolver solo `batchSize` filas con info para seguir paginando
                const paginatedData = jsonData.slice(0, batchSize);

                res.json({
                    sheet: selectedSheet,
                    totalRows: jsonData.length,
                    batchSize,
                    hasNextPage: true,
                    nextPage: `/convert?fileUrl=${encodeURIComponent(fileUrl)}&offset=${batchSize}`,
                    data: paginatedData,
                });

            } catch (error) {
                res.status(500).json({ error: "Error al procesar el archivo.", details: error.message });
            } finally {
                tempFile.removeCallback(); // Eliminar el archivo temporal
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Error en la descarga del archivo.", details: error.message });
    }
});

// **Ruta para continuar la paginación**
app.get("/convert", async (req, res) => {
    try {
        const { fileUrl, offset = 0 } = req.query;
        const batchSize = 500;

        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name);
                const selectedSheet = workbook.SheetNames[0]; // Toma la primera hoja automáticamente
                const sheet = workbook.Sheets[selectedSheet];
                const jsonData = xlsx.utils.sheet_to_json(sheet);

                const startIndex = parseInt(offset);
                const paginatedData = jsonData.slice(startIndex, startIndex + batchSize);

                const nextOffset = startIndex + batchSize;
                const hasNextPage = nextOffset < jsonData.length;

                res.json({
                    sheet: selectedSheet,
                    totalRows: jsonData.length,
                    batchSize,
                    hasNextPage,
                    nextPage: hasNextPage ? `/convert?fileUrl=${encodeURIComponent(fileUrl)}&offset=${nextOffset}` : null,
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
