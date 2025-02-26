const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

const batchSize = 500; // Tamaño de paginación para archivos grandes

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        // Crear archivo temporal
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });

        // Descargar el archivo sin cargarlo en memoria
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name, { dense: true }); // Dense: optimiza memoria
                const sheets = workbook.SheetNames;

                if (sheets.length === 0) {
                    return res.status(400).json({ error: "El archivo Excel no contiene hojas." });
                }

                const selectedSheet = sheets[0];
                const sheet = workbook.Sheets[selectedSheet];

                // Streaming para archivos grandes: Convierte fila por fila
                let rows = [];
                let rowIndex = 0;
                for (let cell in sheet) {
                    if (cell[0] === "!") continue; // Ignorar metadatos
                    let row = sheet[cell].v; // Obtener valor
                    rows[rowIndex] = rows[rowIndex] || [];
                    rows[rowIndex].push(row);
                    rowIndex++;
                }

                // Convertir a JSON con paginación
                const jsonData = rows.map(row => ({ data: row }));
                const paginatedData = jsonData.slice(0, batchSize);
                const hasNextPage = jsonData.length > batchSize;

                res.json({
                    sheet: selectedSheet,
                    totalRows: jsonData.length,
                    batchSize,
                    hasNextPage,
                    nextPage: hasNextPage ? `/convert?fileUrl=${encodeURIComponent(fileUrl)}&offset=${batchSize}` : null,
                    data: paginatedData
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

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API funcionando en el puerto ${PORT}`));
