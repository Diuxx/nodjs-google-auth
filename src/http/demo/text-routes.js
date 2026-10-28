import { AppError, requireCondition } from '../../lib/errors.js';

const MAX_CONTENT_BYTES = 16 * 1024;
const MAX_FILENAME_LENGTH = 100;

function validateTextFile(body) {
  const { filename, content } = body;
  const validName = filename.length <= MAX_FILENAME_LENGTH &&
    /^[\p{L}\p{N}][\p{L}\p{N} ._()-]*\.txt$/iu.test(filename) &&
    !filename.includes('..');
  requireCondition(validName, 400, 'INVALID_FILENAME',
    'Nom de fichier invalide. Utilise un nom simple terminé par .txt (100 caractères maximum).');
  requireCondition(Buffer.byteLength(content, 'utf8') <= MAX_CONTENT_BYTES,
    413, 'TEXT_FILE_TOO_LARGE', 'Le contenu ne doit pas dépasser 16 Kio en UTF-8.');
  return { filename, content };
}

/**
 * Endpoint réservé à la page interne et à son origine exacte : les autres
 * applications n'ont aucune raison de créer des fichiers Drive visibles.
 */
export function registerDemoTextRoutes(app, { config, drive, requireUser }) {
  app.post('/api/demo/text-file', {
    bodyLimit: 32 * 1024,
    schema: {
      body: {
        type: 'object',
        required: ['filename', 'content'],
        additionalProperties: false,
        properties: {
          filename: { type: 'string', minLength: 5, maxLength: MAX_FILENAME_LENGTH },
          content: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    requireCondition(request.headers.origin === config.publicBaseUrl, 403,
      'ORIGIN_FORBIDDEN', 'La création du fichier est réservée à la page de démonstration.');
    const user = requireUser(request);
    const { filename, content } = validateTextFile(request.body);
    if (!drive?.createTextFile) throw new AppError(503, 'DRIVE_UNAVAILABLE', 'Service Drive indisponible.');
    const created = await drive.createTextFile(user.id, filename, content);
    return reply.code(201).send(created);
  });
}
