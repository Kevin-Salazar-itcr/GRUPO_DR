const express = require("express");
const cors = require("cors");
const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const SPREADSHEET_ID = "1aahcevhtLzx7QEb5DWnLR7ef1GKET57arpH05Bw46IE";
const SHEET_NAME = "Hoja 13";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const CREDENTIALS_PATH = "credentials.json";
const TOKEN_PATH = "token.json";

let oAuth2Client;

// 👉 Función para iniciar OAuth y guardar token
async function autorizarInteractivo(credentials) {
  const { client_secret, client_id } = credentials.installed;

  // 👇 Se reemplaza redirect_uris[0] por el modo manual
  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n🔗 Abrí este enlace en el navegador y copiá el código:");
  console.log(authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\n🔑 Pegá aquí el código de autorización: ", (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          console.error("❌ Error al obtener el token:", err);
          return;
        }
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        oAuth2Client.setCredentials(token);
        console.log("✅ Token guardado como token.json");
        resolve();
      });
    });
  });
}

// 👉 Inicializa el cliente OAuth
async function inicializar() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id } = credentials.installed;

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
  } else {
    await autorizarInteractivo(credentials);
  }
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
    // Leer todas las filas de la hoja para saber dónde termina el contenido
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
        values: [datos], // 👈 una fila, múltiples columnas
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
  app.listen(3000, () => {
    console.log("✅ API corriendo en http://localhost:3000");
  });
});
