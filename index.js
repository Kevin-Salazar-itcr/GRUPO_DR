require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);

let oAuth2Client;
let sheets;

// Refrescar token si expiró y actualizar en Railway
async function verificarYRefrescarToken() {
  const ahora = Date.now();
  const expiracion = token.expiry_date;

  if (expiracion && ahora < expiracion - 60000) return;

  console.log("🔄 Token expirado o por expirar. Refrescando...");

  const { client_id, client_secret } = credentials.installed;

  try {
    if (!token.refresh_token) {
      console.error("⚠️ No se encontró refresh_token. No se puede refrescar el token.");
      return;
    }

    const tempClient = new google.auth.OAuth2(
      client_id,
      client_secret,
      "urn:ietf:wg:oauth:2.0:oob"
    );
    tempClient.setCredentials(token);

    await tempClient.getAccessToken();

    const nuevaCredencial = tempClient.credentials;

    token.access_token = nuevaCredencial.access_token;
    token.expiry_date = nuevaCredencial.expiry_date;

    oAuth2Client.setCredentials(token);
    sheets = google.sheets({ version: "v4", auth: oAuth2Client });

    console.log("✅ Token actualizado. Subiendo a Railway...");

    const graphqlQuery = `
      mutation($projectId: String!, $key: String!, $value: String!) {
        secretsUpsert(input: {
          projectId: $projectId,
          secrets: [
            { key: $key, value: $value }
          ]
        }) {
          id
        }
      }
    `;

    const graphqlVariables = {
      projectId: process.env.RAILWAY_PROJECT_ID,
      key: "GOOGLE_TOKEN_JSON",
      value: JSON.stringify(token),
    };

    await axios.post(
      "https://backboard.railway.app/graphql/v2",
      {
        query: graphqlQuery,
        variables: graphqlVariables,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
        },
      }
    );

    console.log("🚀 Secret GOOGLE_TOKEN_JSON actualizado correctamente en Railway.");
  } catch (err) {
    console.error("❌ Error al refrescar o subir el token:");
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.stack || err.message || err);
    }
  }
}

// Inicializar autenticación
async function inicializar() {
  const { client_secret, client_id } = credentials.installed;

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  oAuth2Client.setCredentials(token);
  sheets = google.sheets({ version: "v4", auth: oAuth2Client });
}

// POST /escribir
app.post("/escribir", async (req, res) => {
  const { datos, hoja } = req.body;

  if (!Array.isArray(datos) || !hoja) {
    return res.status(400).json({ error: "Faltan 'datos' o 'hoja'" });
  }

  try {
    await verificarYRefrescarToken();

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

// POST /updatePorID
app.post("/updatePorID", async (req, res) => {
  const { datos, hoja } = req.body;

  if (!Array.isArray(datos) || !hoja || !datos[0]) {
    return res.status(400).json({ error: "Se requiere 'datos' (con ID al inicio) y 'hoja'" });
  }

  try {
    await verificarYRefrescarToken();

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

// POST /borrarPorID
app.post("/borrarPorID", async (req, res) => {
  const { id, hoja } = req.body;

  if (!id || !hoja) {
    return res.status(400).json({ error: "Se requiere 'id' y 'hoja'" });
  }

  try {
    await verificarYRefrescarToken();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${hoja}`,
    });

    const filas = response.data.values || [];
    const filaIndex = filas.findIndex(fila => fila[0] === id);

    if (filaIndex === -1) {
      return res.status(404).json({ error: `ID '${id}' no encontrado en la hoja '${hoja}'` });
    }

    const rango = `${hoja}!A${filaIndex + 1}:Z${filaIndex + 1}`;

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
  app.listen(PORT, () => {
    console.log(`✅ API ejecutándose en puerto ${PORT}`);
  });
});
