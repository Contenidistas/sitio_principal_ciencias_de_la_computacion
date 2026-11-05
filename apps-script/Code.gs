const SPREADSHEET_ID = '1g-WEMG1UmNolDxzNOUvy1DiBYMijWPuxRLhJ7Fq1ThY';
const VISITS_SHEET = 'Contador_visitas';
const REVIEWS_SHEET = 'Resenas_recursos';
const VISITS_HEADERS = ['Indicador', 'Valor'];
const REVIEWS_HEADERS = ['Fecha UTC', 'Id recurso', 'Recurso', 'URL', 'Puntuacion', 'Comentario'];

function setup() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const visits = getOrCreateSheet_(spreadsheet, VISITS_SHEET, VISITS_HEADERS);
  if (visits.getLastRow() < 2) {
    visits.getRange(2, 1, 1, 2).setValues([['Visitas totales', 0]]);
  }
  getOrCreateSheet_(spreadsheet, REVIEWS_SHEET, REVIEWS_HEADERS);
}

function doGet(e) {
  const callback = e && e.parameter ? e.parameter.callback : '';
  if (!/^__siteFeedback_[a-zA-Z0-9_]+$/.test(callback || '')) {
    return ContentService.createTextOutput('Invalid callback')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    const action = e.parameter.action;
    let result;
    if (action === 'stats') {
      result = { ok: true, totalVisits: readVisitCount_() };
    } else if (action === 'reviews') {
      result = readReviews_(e.parameter.resourceId);
    } else {
      throw new Error('Accion no valida.');
    }
    return jsonp_(callback, result);
  } catch (error) {
    return jsonp_(callback, {
      ok: false,
      error: error && error.message ? error.message : 'No se pudo consultar la hoja.'
    });
  }
}

function doPost(e) {
  let nonce = '';
  try {
    const rawPayload = e && e.parameter ? e.parameter.payload : '';
    if (!rawPayload || rawPayload.length > 5000) {
      throw new Error('Solicitud vacia o demasiado extensa.');
    }

    const payload = JSON.parse(rawPayload);
    nonce = String(payload.nonce || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(nonce)) {
      throw new Error('Identificador de solicitud no valido.');
    }

    let result;
    if (payload.action === 'visit') {
      result = { totalVisits: incrementVisitCount_() };
    } else if (payload.action === 'review') {
      result = { review: addReview_(payload) };
    } else {
      throw new Error('Accion no valida.');
    }
    return postMessage_({ ok: true, nonce: nonce, result: result });
  } catch (error) {
    return postMessage_({
      ok: false,
      nonce: nonce,
      error: error && error.message ? error.message : 'No se pudo guardar la informacion.'
    });
  }
}

function readVisitCount_() {
  const sheet = getOrCreateSheet_(
    SpreadsheetApp.openById(SPREADSHEET_ID),
    VISITS_SHEET,
    VISITS_HEADERS
  );
  return Number(sheet.getRange(2, 2).getValue()) || 0;
}

function incrementVisitCount_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet_(
      SpreadsheetApp.openById(SPREADSHEET_ID),
      VISITS_SHEET,
      VISITS_HEADERS
    );
    const cell = sheet.getRange(2, 2);
    const nextCount = (Number(cell.getValue()) || 0) + 1;
    cell.setValue(nextCount);
    return nextCount;
  } finally {
    lock.releaseLock();
  }
}

function readReviews_(resourceId) {
  const id = String(resourceId || '').trim();
  if (!id || id.length > 2000) {
    throw new Error('Recurso no valido.');
  }

  const sheet = getOrCreateSheet_(
    SpreadsheetApp.openById(SPREADSHEET_ID),
    REVIEWS_SHEET,
    REVIEWS_HEADERS
  );
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, count: 0, average: 0, reviews: [] };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, REVIEWS_HEADERS.length).getValues();
  const matching = rows.filter(function(row) {
    return String(row[1]) === id;
  });
  const ratings = matching.map(function(row) {
    return Number(row[4]);
  });
  const average = ratings.length
    ? ratings.reduce(function(total, rating) { return total + rating; }, 0) / ratings.length
    : 0;
  const reviews = matching.slice(-50).reverse().map(function(row) {
    return {
      date: row[0] instanceof Date
        ? Utilities.formatDate(row[0], 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'")
        : '',
      rating: Number(row[4]),
      comment: String(row[5])
    };
  });

  return {
    ok: true,
    count: matching.length,
    average: Math.round(average * 10) / 10,
    reviews: reviews
  };
}

function addReview_(payload) {
  if (String(payload.website || '').trim()) {
    throw new Error('No se pudo validar la reseña.');
  }

  const resourceName = cleanText_(payload.resourceName, 200);
  const resourceUrl = String(payload.resourceUrl || '').trim();
  const resourceId = String(payload.resourceId || '').trim();
  const comment = cleanText_(payload.comment, 1000);
  const rating = Number(payload.rating);

  if (!resourceName || !comment || comment.length < 3) {
    throw new Error('Completa el recurso y escribe una reseña de al menos 3 caracteres.');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('La puntuacion debe ser un numero del 1 al 5.');
  }
  if (!/^https?:\/\//i.test(resourceUrl) || resourceUrl.length > 2000) {
    throw new Error('La URL del recurso no es valida.');
  }
  if (normalizeResourceId_(resourceUrl) !== resourceId) {
    throw new Error('No se pudo validar el recurso.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateSheet_(
      SpreadsheetApp.openById(SPREADSHEET_ID),
      REVIEWS_SHEET,
      REVIEWS_HEADERS
    );
    sheet.appendRow([
      new Date(),
      resourceId,
      safeCell_(resourceName),
      resourceUrl,
      rating,
      safeCell_(comment)
    ]);
  } finally {
    lock.releaseLock();
  }

  return { rating: rating, comment: comment };
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeCell_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function normalizeResourceId_(url) {
  return String(url)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('#')[0]
    .replace(/\/(?=\?|$)/, '');
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const actualHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (headers.some(function(header, index) { return actualHeaders[index] !== header; })) {
      throw new Error('La hoja "' + name + '" ya existe con encabezados incompatibles.');
    }
  }
  return sheet;
}

function jsonp_(callback, data) {
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  return ContentService.createTextOutput(callback + '(' + serialized + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function postMessage_(data) {
  const serialized = JSON.stringify(data).replace(/[<>&]/g, function(character) {
    return '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
  });
  const html = '<!doctype html><html><body><script>' +
    'window.parent.postMessage(' + serialized + ',"*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
