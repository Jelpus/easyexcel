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

                // 🔹 Extraer datos en formato de matriz (cada fila como array)
                const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                // 🔹 Verificar si hay contenido
                if (rawData.length < 2) {
                    return res.status(400).json({ error: "El archivo no contiene datos suficientes." });
                }

                // 🔹 Tomar la primera fila como encabezados y convertir el resto a objetos
                const headers = rawData[0]; // Primera fila = claves
                const jsonData = rawData.slice(1).map(row => {
                    let obj = {};
                    row.forEach((cell, index) => {
                        obj[headers[index] || `Column${index + 1}`] = cell || null;
                    });
                    return obj;
                });

                // 🔹 Aplicar paginación
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
