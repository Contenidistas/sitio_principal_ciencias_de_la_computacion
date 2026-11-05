(function() {
  "use strict";

  const API_URL = "https://script.google.com/macros/s/AKfycbys_wPymVyYf1ZIvUJYku-0hDRPHtS0JYHpVr_O9XROP3Y-J1oz-N7w7KKnU32Gzyeu/exec";
  const API_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
  const STYLE_ID = "site-feedback-styles";
  const REQUEST_TIMEOUT_MS = 15000;
  const REVIEW_COOLDOWN_MS = 60000;
  const REVIEW_CONFIRM_ATTEMPTS = 4;
  const resourcesByButton = new WeakMap();

  const styles = `
    #site-feedback-counter {
      position: fixed;
      z-index: 1000;
      right: 1rem;
      bottom: 1rem;
      padding: .65rem .9rem;
      border: 1px solid #cbd5e1;
      border-radius: 9999px;
      background: #fff;
      color: #1e293b;
      box-shadow: 0 4px 14px rgba(15, 23, 42, .16);
      font: 600 14px/1.3 system-ui, sans-serif;
    }
    .site-feedback-trigger {
      display: inline-block;
      margin: .35rem .5rem;
      padding: .45rem .7rem;
      border: 1px solid #cbd5e1;
      border-radius: .375rem;
      background: #fff;
      color: #1e40af;
      cursor: pointer;
      font: 600 13px/1.3 system-ui, sans-serif;
    }
    .site-feedback-trigger:hover, .site-feedback-trigger:focus-visible {
      background: #eff6ff;
    }
    #site-feedback-dialog {
      width: min(94vw, 36rem);
      max-height: 85vh;
      padding: 0;
      border: 0;
      border-radius: .75rem;
      color: #1e293b;
      box-shadow: 0 20px 50px rgba(15, 23, 42, .3);
      font: 16px/1.5 system-ui, sans-serif;
    }
    #site-feedback-dialog::backdrop { background: rgba(15, 23, 42, .55); }
    .site-feedback-panel { padding: 1.25rem; }
    .site-feedback-heading { margin: 0 2.5rem .25rem 0; font-size: 1.25rem; font-weight: 700; }
    .site-feedback-summary { margin: 0 0 1rem; color: #475569; }
    .site-feedback-close {
      position: absolute;
      top: .8rem;
      right: .8rem;
      border: 0;
      background: transparent;
      color: #334155;
      cursor: pointer;
      font-size: 1.5rem;
    }
    .site-feedback-list { max-height: 14rem; overflow: auto; margin: .75rem 0 1rem; padding: 0; list-style: none; }
    .site-feedback-review { padding: .75rem 0; border-top: 1px solid #e2e8f0; }
    .site-feedback-review p { margin: .25rem 0 0; overflow-wrap: anywhere; }
    .site-feedback-stars { color: #b45309; font-weight: 700; }
    .site-feedback-form { display: grid; gap: .65rem; }
    .site-feedback-form label { display: grid; gap: .25rem; font-weight: 600; }
    .site-feedback-form select, .site-feedback-form textarea {
      width: 100%;
      padding: .55rem;
      border: 1px solid #94a3b8;
      border-radius: .375rem;
      color: #0f172a;
      font: inherit;
    }
    .site-feedback-form textarea { min-height: 5rem; resize: vertical; }
    .site-feedback-submit {
      justify-self: start;
      padding: .55rem .9rem;
      border: 0;
      border-radius: .375rem;
      background: #1d4ed8;
      color: #fff;
      cursor: pointer;
      font: 600 14px/1.4 system-ui, sans-serif;
    }
    .site-feedback-submit:disabled { opacity: .6; cursor: wait; }
    .site-feedback-message { min-height: 1.5em; margin: .25rem 0 0; color: #334155; }
    .site-feedback-honeypot {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
    }
    @media (max-width: 480px) {
      #site-feedback-counter { right: .5rem; bottom: .5rem; font-size: 12px; }
      .site-feedback-trigger { margin-left: .25rem; }
    }
  `;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function createCounter() {
    const counter = document.createElement("div");
    counter.id = "site-feedback-counter";
    counter.setAttribute("role", "status");
    counter.setAttribute("aria-live", "polite");
    counter.textContent = "Visitas al sitio: conectando…";
    document.body.appendChild(counter);
    return counter;
  }

  function makeRequestId() {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return "sf_" + Array.from(bytes, function(byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }
    return "sf_" + Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2);
  }

  function requestJsonp(parameters) {
    return new Promise(function(resolve, reject) {
      const callbackName = "__siteFeedback_" + makeRequestId().replace(/-/g, "_");
      const script = document.createElement("script");
      const timeout = window.setTimeout(function() {
        cleanup();
        reject(new Error("Se agotó el tiempo de espera al consultar las reseñas."));
      }, REQUEST_TIMEOUT_MS);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }

      window[callbackName] = function(response) {
        cleanup();
        if (!response || response.ok !== true) {
          reject(new Error(response && response.error
            ? response.error
            : "No se pudo consultar el servicio."));
          return;
        }
        resolve(response);
      };

      const query = new URLSearchParams(Object.assign({}, parameters, {
        callback: callbackName
      }));
      script.onerror = function() {
        cleanup();
        reject(new Error("No se pudo conectar con Google Apps Script."));
      };
      script.src = API_URL + "?" + query.toString();
      document.head.appendChild(script);
    });
  }

  function postRequest(payload) {
    return new Promise(function(resolve, reject) {
      const nonce = makeRequestId();
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("input");
      let submitted = false;
      let completed = false;
      const timeout = window.setTimeout(function() {
        cleanup();
        reject(new Error("No se recibió respuesta al guardar. Inténtalo nuevamente."));
      }, REQUEST_TIMEOUT_MS);

      iframe.name = "site_feedback_" + nonce;
      iframe.title = "Respuesta del servicio de reseñas";
      iframe.hidden = true;
      iframe.src = "about:blank";
      form.method = "POST";
      form.action = API_URL;
      form.target = iframe.name;
      form.hidden = true;
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(Object.assign({}, payload, { nonce: nonce }));
      form.appendChild(input);

      function cleanup() {
        completed = true;
        window.clearTimeout(timeout);
        iframe.removeEventListener("load", onLoad);
        window.removeEventListener("message", onMessage);
        form.remove();
        iframe.remove();
      }

      function onLoad() {
        if (!submitted) {
          submitted = true;
          try {
            form.submit();
          } catch (error) {
            cleanup();
            reject(new Error("No se pudo enviar la solicitud a Google Apps Script."));
          }
          return;
        }
        window.setTimeout(function() {
          if (completed) return;
          cleanup();
          resolve();
        }, 500);
      }

      function onMessage(event) {
        if (!event.data ||
            event.data.nonce !== nonce) {
          return;
        }
        cleanup();
        if (event.data.ok !== true) {
          reject(new Error(event.data.error || "No se pudo guardar."));
          return;
        }
        resolve(event.data.result);
      }

      iframe.addEventListener("load", onLoad);
      window.addEventListener("message", onMessage);
      document.body.appendChild(form);
      document.body.appendChild(iframe);
    });
  }

  function normalizeResource(url) {
    const normalized = new URL(url, window.location.href);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return "";
    }
    normalized.hash = "";
    return normalized.href
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("#")[0]
      .replace(/\/(?=\?|$)/, "");
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function stars(rating) {
    const score = Math.max(0, Math.min(5, Number(rating) || 0));
    const rounded = Math.round(score);
    return "★".repeat(rounded) + "☆".repeat(5 - rounded);
  }

  function createDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "site-feedback-dialog";
    dialog.setAttribute("aria-labelledby", "site-feedback-title");
    const panel = createElement("div", "site-feedback-panel");
    const close = createElement("button", "site-feedback-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Cerrar reseñas");
    close.addEventListener("click", function() { dialog.close(); });

    const title = createElement("h2", "site-feedback-heading");
    title.id = "site-feedback-title";
    const summary = createElement("p", "site-feedback-summary");
    const message = createElement("p", "site-feedback-message");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    const list = createElement("ul", "site-feedback-list");

    const form = createElement("form", "site-feedback-form");
    const ratingLabel = createElement("label", "", "Tu valoración");
    const rating = document.createElement("select");
    rating.name = "rating";
    rating.required = true;
    for (let score = 5; score >= 1; score -= 1) {
      const option = document.createElement("option");
      option.value = String(score);
      option.textContent = score + " - " + stars(score);
      rating.appendChild(option);
    }
    ratingLabel.appendChild(rating);

    const commentLabel = createElement("label", "", "Reseña");
    const comment = document.createElement("textarea");
    comment.name = "comment";
    comment.required = true;
    comment.minLength = 3;
    comment.maxLength = 1000;
    comment.placeholder = "¿Qué te pareció este recurso?";
    commentLabel.appendChild(comment);

    const honeypotLabel = createElement("label", "site-feedback-honeypot", "Deja este campo vacío");
    const honeypot = document.createElement("input");
    honeypot.name = "website";
    honeypot.tabIndex = -1;
    honeypot.autocomplete = "off";
    honeypotLabel.appendChild(honeypot);

    const note = createElement("small", "", "Las reseñas se publican de inmediato. No incluyas datos personales.");
    const submit = createElement("button", "site-feedback-submit", "Publicar reseña");
    submit.type = "submit";
    form.append(ratingLabel, commentLabel, honeypotLabel, note, submit);
    panel.append(close, title, summary, list, form, message);
    dialog.appendChild(panel);
    document.body.appendChild(dialog);

    return {
      dialog: dialog,
      title: title,
      summary: summary,
      list: list,
      form: form,
      rating: rating,
      comment: comment,
      honeypot: honeypot,
      submit: submit,
      message: message
    };
  }

  function renderReviews(state, response) {
    state.summary.textContent = response.count
      ? "Promedio: " + response.average + " de 5 (" + response.count +
        (response.count === 1 ? " reseña)" : " reseñas)")
      : "Todavía no hay reseñas para este recurso.";
    state.list.replaceChildren();

    response.reviews.forEach(function(review) {
      const item = createElement("li", "site-feedback-review");
      const score = createElement("span", "site-feedback-stars",
        stars(review.rating) + " " + review.rating + "/5");
      item.appendChild(score);
      if (review.date) {
        const time = document.createElement("time");
        const parsedDate = new Date(review.date);
        if (!Number.isNaN(parsedDate.getTime())) {
          time.dateTime = parsedDate.toISOString();
          time.textContent = " · " + parsedDate.toLocaleDateString();
          item.appendChild(time);
        }
      }
      item.appendChild(createElement("p", "", review.comment));
      state.list.appendChild(item);
    });
  }

  function makeResourceId(url) {
    return normalizeResource(url);
  }

  function renderResourceButton(resource) {
    const hasReviews = resource.reviewCount > 0;
    const ratingText = hasReviews
      ? "★ " + resource.average + " · " + resource.reviewCount
      : "★ Valorar";
    const clicks = Number(resource.clicks) || 0;
    const clickText = clicks.toLocaleString() +
      (clicks === 1 ? " clic" : " clics");
    resource.button.textContent = ratingText +
      (resource.clicksAvailable ? " · ↗ " + clickText : "");
    resource.button.title = (hasReviews
      ? "Promedio: " + resource.average + " de 5 (" + resource.reviewCount +
        (resource.reviewCount === 1 ? " reseña). " : " reseñas). ")
      : "Todavía no hay reseñas. ") + (resource.clicksAvailable
        ? "Clics en el recurso: " + clickText + "."
        : "El contador de clics no está disponible.");
    resource.button.setAttribute("aria-label",
      "Ver o dejar reseñas: " + resource.name + (hasReviews
        ? ". Promedio " + resource.average + " de 5, " + resource.reviewCount +
          (resource.reviewCount === 1 ? " reseña." : " reseñas.")
        : ". Todavía no tiene reseñas.") + (resource.clicksAvailable
          ? " " + clickText + " en el recurso."
          : ""));
  }

  function addReviewButtons(openReviews) {
    document.querySelectorAll(
      "a.resource-btn[href], a[data-resource-review][href]"
    ).forEach(function(link) {
      if (link.classList.contains("inactive") ||
          link.nextElementSibling &&
          link.nextElementSibling.classList.contains("site-feedback-trigger")) {
        return;
      }
      const resourceId = makeResourceId(link.href);
      if (!resourceId) return;

      const button = createElement("button", "site-feedback-trigger", "★ Valorar");
      button.type = "button";
      button.dataset.resourceId = resourceId;
      const resource = {
        id: resourceId,
        url: link.href.split("#")[0],
        name: link.textContent.trim() || "Recurso",
        button: button,
        reviewCount: 0,
        average: 0,
        clicks: 0,
        clicksAvailable: false
      };
      resourcesByButton.set(button, resource);
      button.dataset.resourceName = resource.name;
      button.setAttribute("aria-label", "Ver o dejar reseñas: " + resource.name);
      link.addEventListener("click", function(event) {
        if (event.defaultPrevented || event.button !== 0 ||
            event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        trackResourceClick(resource);
      });
      button.addEventListener("click", function() {
        openReviews(resource);
      });
      link.insertAdjacentElement("afterend", button);
    });
  }

  function trackResourceClick(resource) {
    const payload = {
      action: "resourceVisit",
      nonce: makeRequestId(),
      resourceId: resource.id,
      resourceUrl: resource.url,
      resourceName: resource.name
    };
    const formBody = new URLSearchParams({ payload: JSON.stringify(payload) });
    const beaconBody = new Blob([formBody.toString()], {
      type: "application/x-www-form-urlencoded;charset=UTF-8"
    });

    if (navigator.sendBeacon && navigator.sendBeacon(API_URL, beaconBody)) {
      if (resource.clicksAvailable) {
        resource.clicks += 1;
        renderResourceButton(resource);
      }
      return;
    }

    postRequest(payload)
      .then(function() {
        if (resource.clicksAvailable) {
          resource.clicks += 1;
          renderResourceButton(resource);
        }
      })
      .catch(function(error) {
        resource.button.title = "No se pudo registrar el clic: " + error.message;
      });
  }

  function updateResourceRating(resource, response) {
    resource.reviewCount = response.count;
    resource.average = response.average;
    renderResourceButton(resource);
  }

  function loadResourceStats() {
    return requestJsonp({ action: "resourceStats" })
      .then(function(response) {
        document.querySelectorAll(".site-feedback-trigger[data-resource-id]")
          .forEach(function(button) {
            const resource = resourcesByButton.get(button);
            if (!resource) return;
            const ratings = response.ratings || {};
            const rating = Object.prototype.hasOwnProperty.call(ratings, resource.id)
              ? ratings[resource.id]
              : {};
            resource.reviewCount = Number(rating.count) || 0;
            resource.average = Number(rating.average) || 0;
            const counts = response.counts || {};
            resource.clicks = Number(
              Object.prototype.hasOwnProperty.call(counts, resource.id)
                ? counts[resource.id]
                : 0
            ) || 0;
            resource.clicksAvailable = true;
            renderResourceButton(resource);
          });
      })
      .catch(function(error) {
        const resources = [];
        document.querySelectorAll(".site-feedback-trigger[data-resource-id]")
          .forEach(function(button) {
            const resource = resourcesByButton.get(button);
            if (resource) resources.push(resource);
          });
        return Promise.all(resources.map(function(resource) {
          return requestJsonp({ action: "reviews", resourceId: resource.id })
            .then(function(response) {
              updateResourceRating(resource, response);
              resource.button.title += " No se pudieron cargar los clics: " +
                error.message;
            })
            .catch(function(reviewError) {
              resource.button.title = "No se pudieron cargar las valoraciones ni los clics: " +
                reviewError.message;
            });
        }));
      });
  }

  function waitForReview(resource, rating, comment, previousCount, attempt, submittedAt) {
    return requestJsonp({ action: "reviews", resourceId: resource.id })
      .then(function(response) {
        const saved = response.reviews.some(function(review) {
          const reviewTime = new Date(review.date).getTime();
          return Number(review.rating) === rating &&
            review.comment === comment &&
            (!Number.isFinite(reviewTime) || reviewTime >= submittedAt - 2000);
        });
        if (response.count > previousCount && saved) {
          return response;
        }
        if (attempt >= REVIEW_CONFIRM_ATTEMPTS) {
          throw new Error("No se pudo confirmar la reseña guardada. Recarga la página para comprobarla.");
        }
        return new Promise(function(resolve) {
          window.setTimeout(resolve, 750);
        }).then(function() {
          return waitForReview(
            resource,
            rating,
            comment,
            previousCount,
            attempt + 1,
            submittedAt
          );
        });
      });
  }

  function configureFeedback(counter) {
    if (!API_URL_PATTERN.test(API_URL)) {
      counter.textContent = "Visitas y reseñas: pendientes de conexión";
      counter.title = "Configura la URL de despliegue de Google Apps Script.";
      return;
    }

    const state = createDialog();
    const lastReviewByResource = new Map();
    let activeResource = null;

    function openReviews(resource) {
      activeResource = resource;
      state.title.textContent = resource.name;
      state.summary.textContent = "Cargando reseñas…";
      state.message.textContent = "";
      state.list.replaceChildren();
      state.form.reset();
      resource.button.setAttribute("aria-busy", "true");
      state.dialog.showModal();
      state.rating.focus();

      requestJsonp({ action: "reviews", resourceId: resource.id })
        .then(function(response) {
          renderReviews(state, response);
          updateResourceRating(resource, response);
        })
        .catch(function(error) {
          state.summary.textContent = "No se pudieron cargar las reseñas.";
          state.message.textContent = error.message;
        })
        .finally(function() {
          resource.button.removeAttribute("aria-busy");
        });
    }

    state.form.addEventListener("submit", function(event) {
      event.preventDefault();
      if (!activeResource || !state.form.reportValidity()) return;

      const resource = activeResource;
      const rating = Number(state.rating.value);
      const comment = state.comment.value.trim();
      const submittedAt = Date.now();
      const previousCount = resource.reviewCount || 0;
      const lastReview = lastReviewByResource.get(resource.id) || 0;
      if (Date.now() - lastReview < REVIEW_COOLDOWN_MS) {
        state.message.textContent = "Espera un minuto antes de publicar otra reseña de este recurso.";
        return;
      }

      state.submit.disabled = true;
      state.message.textContent = "Enviando reseña…";
      postRequest({
        action: "review",
        resourceId: resource.id,
        resourceUrl: resource.url,
        resourceName: resource.name,
        rating: rating,
        comment: comment,
        website: state.honeypot.value
      })
        .then(function() {
          lastReviewByResource.set(resource.id, Date.now());
          state.message.textContent = "¡Gracias! Tu reseña ya fue publicada.";
          state.form.reset();
          return waitForReview(
            resource,
            rating,
            comment,
            previousCount,
            1,
            submittedAt
          );
        })
        .then(function(response) {
          renderReviews(state, response);
          updateResourceRating(resource, response);
          state.message.textContent = "¡Gracias! Tu reseña ya fue publicada.";
          state.dialog.close();
          resource.button.focus();
        })
        .catch(function(error) {
          state.message.textContent = error.message;
        })
        .finally(function() {
          state.submit.disabled = false;
        });
    });

    addReviewButtons(openReviews);
    loadResourceStats();

    requestJsonp({ action: "stats" })
      .then(function(response) {
        counter.textContent = "Visitas al sitio: " +
          Number(response.totalVisits).toLocaleString();
        return postRequest({ action: "visit" })
          .then(function() {
            return requestJsonp({ action: "stats" });
          })
          .then(function(updatedResponse) {
            counter.textContent = "Visitas al sitio: " +
              Number(updatedResponse.totalVisits).toLocaleString();
          })
          .catch(function(error) {
            counter.title = "No se pudo registrar esta visita: " + error.message;
          });
      })
      .catch(function(error) {
        counter.textContent = "Visitas al sitio: no disponibles";
        counter.title = error.message;
      });
  }

  function initialize() {
    if (!document.body || !document.head) return;
    addStyles();
    const counter = createCounter();
    configureFeedback(counter);
  }

  initialize();
})();
