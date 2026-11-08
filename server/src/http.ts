import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Wraps an async handler so a rejected promise reaches the error middleware instead of hanging. */
export function handler(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    // Turn "rate: Expected number, received string" into something a shopkeeper could act on.
    const first = err.issues[0];
    res.status(400).json({ error: first ? first.path.join('.') + ': ' + first.message : 'Invalid request' });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // The JSON reader's own refusals: a body too big, or not JSON at all. Theirs to say, not a 500.
  const type = (err as { type?: unknown })?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'That is too large to send to the server' });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'That is not readable: the file or the request is damaged' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
