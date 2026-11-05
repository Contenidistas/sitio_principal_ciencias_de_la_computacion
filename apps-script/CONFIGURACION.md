# Configuración de visitas y reseñas

La integración utiliza Google Apps Script como endpoint y añade tres pestañas dedicadas a la hoja editable. Las valoraciones aparecen en los enlaces de recursos y en los documentos oficiales del inicio:

- `Contador_visitas`: un total agregado de páginas vistas.
- `Resenas_recursos`: una fila por valoración, asociada a la URL del recurso.
- `Visitas_recursos`: un total agregado de clics en los enlaces de cada recurso.

No se guardan nombres, correos, direcciones IP ni identificadores de visitantes. Las visitas por recurso cuentan clics en los enlaces del sitio; no permiten saber quién hizo clic ni confirmar que llegó a leer el recurso, sobre todo cuando se abre un sitio externo. Las reseñas son públicas y se muestran inmediatamente. El formulario limita el tamaño del texto, valida la puntuación y usa un campo trampa y una pausa local entre envíos; al ser un endpoint público, eso no sustituye un CAPTCHA ni una moderación si se detecta spam.

## Desplegar Apps Script

1. Abre [script.google.com](https://script.google.com) con una cuenta que pueda editar la hoja.
2. Crea un proyecto y reemplaza el contenido de `Code.gs` con el archivo de este directorio.
3. Guarda el proyecto y selecciona la función `setup`; ejecútala y autoriza el acceso a la hoja. Solo crea las pestañas dedicadas si faltan y no borra otras pestañas.
4. Si ya hay una implementación, abre **Implementar > Administrar implementaciones**, edítala, selecciona **Nueva versión** y vuelve a implementar. Si todavía no hay una, selecciona **Implementar > Nueva implementación > Aplicación web**.
5. Configura **Ejecutar como: yo** y el acceso para que pueda usarlo cualquier visitante (**Cualquier persona**). El código limita las operaciones públicas a contar visitas, sumar clics anónimos en recursos, leer promedios/reseñas y añadir una reseña validada.
6. Copia la URL de la aplicación web que termina en `/exec`. Al actualizar la implementación existente, conserva la URL configurada en el sitio.
7. En `assets/site-feedback.js`, asigna esa URL a `API_URL` y publica los cambios del sitio.

Mantén la hoja privada. La URL pública de publicación (`pubhtml`) solo permite leer una vista publicada y no se usa para guardar datos. No publiques claves ni tokens de Google.

## Comprobación

- Abre el sitio publicado: el contador debe aumentar al cargar cada página.
- Pulsa un enlace de recurso: aumenta su total agregado de clics, visible junto a la valoración y en la pestaña `Visitas_recursos`.
- En una página de recursos, pulsa **Valorar**, envía una puntuación y comentario de prueba y confirma que aparecen en la pestaña `Resenas_recursos` y en la lista pública.
- Comprueba que otra página que enlaza a la misma URL muestra la misma reseña.

El contador registra cargas de página, incluidas las recargas; no identifica visitantes únicos.
