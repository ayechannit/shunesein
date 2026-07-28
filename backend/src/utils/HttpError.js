// A thrown error carrying the HTTP status the caller should respond with.
// Used inside db.withTransaction() callbacks so validation failures roll back
// the transaction and still map to a clean 4xx response.
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = HttpError;
