class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Wird bei verweigertem Zugriff geworfen, damit der Versuch auditiert werden kann.
class AccessDenied extends HttpError {
  constructor(status, message, details) {
    super(status, message, 'access_denied');
    this.details = details;
  }
}

module.exports = { HttpError, AccessDenied };
