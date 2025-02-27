const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");

const app = express();
app.use(express.json());

const batchSize = 500; // Número de filas por lote para reducir consumo de RAM

app.post("/convert", async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) return res.status(400).json({ error: "Debes proporcionar una URL válida." });

        // 🔹 Descargar el archivo sin cargarlo en memoria
        const tempFile = tmp.fileSync({ postfix: ".xlsx" });
        const writer = fs.createWriteStream(tempFile.name);
        const response = await axios.get(fileUrl, { responseType: "stream" });
        response.data.pipe(writer);

        writer.on("finish", () => {
            try {
                const workbook = xlsx.readFile(tempFile.name, { dense: true });
                const sheets = workbook.SheetNames;
                if (sheets.length === 0) {
                    return res.status(400).json({ error: "El archivo Excel no contiene hojas válidas." });
                }

                const selectedSheet = sheets[0];
                const sheet = workbook.Sheets[selectedSheet];

                // 🔹 Iniciar la respuesta en streaming
                res.setHeader("Content-Type", "application/json");
                res.write(`{"sheet": "${selectedSheet}", "data": [`);

                const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                if (rawData.length < 2) {
                    return res.status(400).json({ error: "El archivo no contiene datos suficientes." });
                }

                const headers = rawData[0];
                let firstRow = true;
                let index = 0;

                function sendChunk() {
                    while (index < rawData.length - 1) {
                        const row = rawData[index + 1].reduce((obj, cell, i) => {
                            obj[headers[i] || `Column${i + 1}`] = cell || null;
                            return obj;
                        }, {});

                        if (!firstRow) res.write(",");
                        res.write(JSON.stringify(row));
                        firstRow = false;

                        index++;

                        // 🔹 Si ya enviamos `batchSize`, hacer una pausa
                        if (index % batchSize === 0) {
                            setTimeout(sendChunk, 10);
                            return;
                        }
                    }

                    res.write("]}"); // 🔹 Cerrar JSON
                    res.end();
                    tempFile.removeCallback(); // 🔹 Eliminar archivo temporal
                }

                sendChunk(); // 🔹 Iniciar envío

            } catch (error) {
                res.status(500).json({ error: "Error procesando el archivo.", details: error.message });
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Error en la descarga del archivo.", details: error.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API funcionando en el puerto ${PORT}`));
