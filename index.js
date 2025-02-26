const express = require("express");
const axios = require("axios");
const xlsx = require("xlsx");
const fs = require("fs");
const tmp = require("tmp");
const { Readable } = require("stream");

const app = express();
app.use(express.json());

const batchSize = 500; // Número de filas por lote para evitar consumir mucha memoria

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
                const workbook = xlsx.readFile(tempFile.name, { dense: true }); // Optimizamos la lectura
                const sheets = workbook.SheetNames;

                if (sheets.length === 0) {
                    return res.status(400).json({ error: "El archivo Excel no contiene hojas." });
                }

                const selectedSheet = sheets[0];
                const sheet = workbook.Sheets[selectedSheet];

                // 🔹 Leer Excel con streaming
                const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                if (rawData.length < 2) {
                    return res.status(400).json({ error: "El archivo no contiene datos suficientes." });
                }

                const headers = rawData[0]; // Primera fila = encabezados
                const totalRows = rawData.length - 1; // Excluyendo encabezados

                // 🔹 Respuesta en Streaming
                res.setHeader("Content-Type", "application/json");
                res.write(`{"sheet": "${selectedSheet}", "totalRows": ${totalRows}, "batchSize": ${batchSize}, "data": [`);

                let firstRow = true;
                let index = 0;

                const readStream = new Readable({
                    read() {
                        while (index < totalRows) {
                            const rowData = rawData[index + 1].reduce((acc, cell, i) => {
                                acc[headers[i] || `Column${i + 1}`] = cell || null;
                                return acc;
                            }, {});

                            if (!firstRow) this.push(",");
                            this.push(JSON.stringify(rowData));

                            firstRow = false;
                            index++;

                            if (index % batchSize === 0) break; // Enviar en bloques de `batchSize`
                        }

                        if (index >= totalRows) {
                            this.push("]}");
                            this.push(null); // Fin del stream
                        }
                    },
                });

                readStream.pipe(res);

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
