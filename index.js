require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);

let oAuth2Client;

// Inicializar autenticación
async function inicializar() {
  const { client_secret, client_id } = credentials.installed;

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  oAuth2Client.setCredentials(token);
}

let sheets;

// POST /escribir - agrega datos al final de la hoja indicada
app.post("/escribir", async (req, res) => {
  const { datos, hoja } = req.body;

  if (!Array.isArray(datos) || !hoja) {
    return res.status(400).json({ error: "Faltan 'datos' o 'hoja'" });
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${hoja}`,
    });

    const existentes = response.data.values || [];
    const filaSiguiente = existentes.length + 1;
    const rango = `${hoja}!A${filaSiguiente}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: rango,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [datos],
      },
    });

    res.json({ mensaje: `Fila agregada en ${hoja} en fila ${filaSiguiente}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al escribir en la hoja" });
  }
});

// POST /updatePorID - busca por ID y reemplaza fila entera
app.post("/updatePorID", async (req, res) => {
  const { datos, hoja } = req.body;

  if (!Array.isArray(datos) || !hoja || !datos[0]) {
    return res.status(400).json({ error: "Se requiere 'datos' (con ID al inicio) y 'hoja'" });
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${hoja}`,
    });

    const filas = response.data.values || [];
    const filaIndex = filas.findIndex(fila => fila[0] === datos[0]);

    if (filaIndex === -1) {
      return res.status(404).json({ error: `ID '${datos[0]}' no encontrado en la hoja '${hoja}'` });
    }

    const rango = `${hoja}!A${filaIndex + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: rango,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [datos],
      },
    });

    res.json({ mensaje: `Fila actualizada en ${hoja} en fila ${filaIndex + 1}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la hoja" });
  }
});

// DELETE /borrarPorID - busca por ID en la columna A y borra la fila
app.delete("/borrarPorID", async (req, res) => {
  const { id, hoja } = req.body;

  if (!id || !hoja) {
    return res.status(400).json({ error: "Se requiere 'id' y 'hoja'" });
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${hoja}`,
    });

    const filas = response.data.values || [];
    const filaIndex = filas.findIndex(fila => fila[0] === id);

    if (filaIndex === -1) {
      return res.status(404).json({ error: `ID '${id}' no encontrado en la hoja '${hoja}'` });
    }

    const rango = `${hoja}!A${filaIndex + 1}:Z${filaIndex + 1}`; // Asumiendo columnas A-Z

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: rango,
    });

    res.json({ mensaje: `Fila con ID '${id}' eliminada en la hoja '${hoja}'` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al borrar en la hoja" });
  }
});

// Iniciar servidor
inicializar().then(() => {
  sheets = google.sheets({ version: "v4", auth: oAuth2Client });
  app.listen(PORT, () => {
    console.log(`✅ API ejecutándose`);
  });
});
