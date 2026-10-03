/* ============================================================
   CONFIGURACIÓN DE LA APP
   Las líneas marcadas con  ⚠️ CAMBIAR  son las que hay que
   modificar al pasar de la cuenta de prueba a la del sacerdote.
   ============================================================ */
window.CONFIG = {
  // ⚠️ CAMBIAR (1/3): Dirección de la implementación de Apps Script
  // (termina en /exec). Si se deja vacío, la app funciona en
  // "modo demostración" sin conectarse a Google Sheets.
  API_URL: "https://script.google.com/macros/s/AKfycbyQgorF_2Qpa9L-9biSHDWFrtwSdxH8ZJKzTx8Omx2SAOfIExfHVGO3XL7j-x44UMMtxw/exec",

  // ⚠️ CAMBIAR (2/3): Enlace a la hoja de Google Sheets de la oficina
  // (el botón "Ver en Excel" abre este enlace).
  SHEET_URL: "https://docs.google.com/spreadsheets/d/13LMxkG6ji9gHN2NZUeZo3MKXv29mURRK1vt9kLzZtho/edit?gid=267922820#gid=267922820",

  // ⚠️ CAMBIAR (3/3, opcional): Nombre que aparece en la app.
  ORG_NOMBRE: "Oratorio · Obra Salesiana de Ciudad Juárez",

  // Versión (súbela cuando cambies archivos para que los celulares se actualicen)
  VERSION: "1.0.0"
};
