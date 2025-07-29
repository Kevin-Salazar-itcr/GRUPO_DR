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

    // Validar variables de entorno necesarias
    if (!process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_API_TOKEN || 
        !process.env.RAILWAY_ENVIRONMENT_ID || !process.env.RAILWAY_SERVICE_ID) {
      console.error("❌ Faltan variables de entorno requeridas:");
      console.error("RAILWAY_PROJECT_ID:", process.env.RAILWAY_PROJECT_ID ? "✅" : "❌");
      console.error("RAILWAY_API_TOKEN:", process.env.RAILWAY_API_TOKEN ? "✅" : "❌");
      console.error("RAILWAY_ENVIRONMENT_ID:", process.env.RAILWAY_ENVIRONMENT_ID ? "✅" : "❌");
      console.error("RAILWAY_SERVICE_ID:", process.env.RAILWAY_SERVICE_ID ? "✅" : "❌");
      return;
    }

    console.log("📊 Variables de entorno Railway:", {
      PROJECT_ID: process.env.RAILWAY_PROJECT_ID ? "✅ Presente" : "❌ Faltante",
      API_TOKEN: process.env.RAILWAY_API_TOKEN ? `✅ Presente (${process.env.RAILWAY_API_TOKEN.length} chars)` : "❌ Faltante",
      ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID ? "✅ Presente" : "❌ Faltante",
      SERVICE_ID: process.env.RAILWAY_SERVICE_ID ? "✅ Presente" : "❌ Faltante"
    });

    // GraphQL mutation correcta según la documentación oficial de Railway
    const graphqlQuery = `
      mutation variableUpsert($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }
    `;

    const graphqlVariables = {
      input: {
        projectId: process.env.RAILWAY_PROJECT_ID,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
        serviceId: process.env.RAILWAY_SERVICE_ID,
        name: "GOOGLE_TOKEN_JSON",
        value: JSON.stringify(token)
      }
    };

    console.log("🔧 Enviando request a Railway GraphQL...");
    console.log("Query:", graphqlQuery);
    console.log("Variables:", {
      input: {
        projectId: graphqlVariables.input.projectId,
        environmentId: graphqlVariables.input.environmentId,
        serviceId: graphqlVariables.input.serviceId,
        name: graphqlVariables.input.name,
        value: "[TOKEN_HIDDEN]" // No mostrar el token en logs
      }
    });

    const response = await axios.post(
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
        timeout: 30000 // 30 segundos timeout
      }
    );

    console.log("📡 Respuesta de Railway:", JSON.stringify(response.data, null, 2));

    if (response.data.errors) {
      console.error("❌ Errores en la respuesta GraphQL:", response.data.errors);
      return;
    }

    console.log("🚀 Secret GOOGLE_TOKEN_JSON actualizado correctamente en Railway.");
  } catch (err) {
    console.error("❌ Error al refrescar o subir el token:");
    
    if (err.response) {
      // Error de respuesta HTTP
      console.error("Status:", err.response.status);
      console.error("Headers:", JSON.stringify(err.response.headers, null, 2));
      console.error("Data:", JSON.stringify(err.response.data, null, 2));
    } else if (err.request) {
      // Error de request
      console.error("Request error:", err.request);
    } else {
      // Error general
      console.error("Error message:", err.message);
      console.error("Stack:", err.stack);
    }

    // Intentar método alternativo usando la API REST de Railway (si existe)
    console.log("🔄 Intentando método alternativo...");
    await intentarActualizacionAlternativa();
  }
}

// Método alternativo para actualizar la variable en Railway
async function intentarActualizacionAlternativa() {
  try {
    // Intentar con la mutation anterior (por si hubo cambios en la API)
    const graphqlQueryLegacy = `
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

    console.log("🔄 Probando con mutation legacy...");

    const response = await axios.post(
      "https://backboard.railway.app/graphql/v2",
      {
        query: graphqlQueryLegacy,
        variables: graphqlVariables,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
        },
        timeout: 30000
      }
    );

    console.log("📡 Respuesta legacy:", JSON.stringify(response.data, null, 2));
    
    if (response.data.errors) {
      console.error("❌ También falló el método legacy:", response.data.errors);
    } else {
      console.log("✅ Método legacy funcionó!");
    }
  } catch (legacyErr) {
    console.error("❌ También falló el método alternativo:", legacyErr.message);
    console.log("⚠️ El token se actualizó localmente pero no se pudo sincronizar con Railway.");
    console.log("💡 Considera actualizar manualmente la variable GOOGLE_TOKEN_JSON en Railway dashboard.");
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

// Endpoint para verificar el estado de las variables
app.get("/debug", async (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    tokenExpiry: new Date(token.expiry_date).toISOString(),
    tokenExpiresIn: Math.round((token.expiry_date - Date.now()) / 1000 / 60) + " minutos",
    hasRefreshToken: !!token.refresh_token,
    railwayVars: {
      projectId: !!process.env.RAILWAY_PROJECT_ID,
      apiToken: !!process.env.RAILWAY_API_TOKEN,
      environmentId: !!process.env.RAILWAY_ENVIRONMENT_ID,
      serviceId: !!process.env.RAILWAY_SERVICE_ID,
      spreadsheetId: !!process.env.SPREADSHEET_ID
    }
  });
});

// Iniciar servidor
inicializar().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ API ejecutándose en puerto ${PORT}`);
    console.log(`🔍 Endpoint de debug disponible en /debug`);
  });
});
