require("dotenv").config(); // 👈 Cargar variables del archivo .env

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = "1JlmjSYLOMWwFHD7FE9HF8UO3T7RxiXuSWTEuojYH3oo";
const SHEET_NAME = "Unidades pendientes";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);

let oAuth2Client;

// 👉 Inicializa OAuth desde variables de entorno
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

// 👉 Endpoints
app.get("/leer", async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:C`,
    });
    res.json(response.data.values || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al leer la hoja" });
  }
});

app.post("/escribir", async (req, res) => {
  const { datos } = req.body;

  if (!Array.isArray(datos) || datos.length === 0) {
    return res.status(400).json({ error: "Se requiere una lista llamada 'datos'" });
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}`,
    });

    const existentes = response.data.values || [];
    const filaSiguiente = existentes.length + 1;

    const rango = `${SHEET_NAME}!A${filaSiguiente}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: rango,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [datos],
      },
    });

    res.json({ mensaje: `Fila agregada en la fila ${filaSiguiente}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al escribir en la hoja" });
  }
});

// 🚀 Inicia la API
inicializar().then(() => {
  sheets = google.sheets({ version: "v4", auth: oAuth2Client });
  app.listen(PORT, () => {
    console.log(`✅ API corriendo en http://localhost:${PORT}`);
  });
});
