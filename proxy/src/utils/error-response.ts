export interface ErrorResponse {
  error: {
    message: string;
    code: string;
  };
}

export function formatErrorResponse(error: Error | string): ErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? ((error as any).code || 'INTERNAL_ERROR') : 'INTERNAL_ERROR';

  return {
    error: {
      message,
      code,
    }
  };
}
