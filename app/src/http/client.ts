import { VestaEnvironment, type VestaSDKConfig } from '../types';

// ─── Erro tipado da API ────────────────────────────────────────────────────────

/**
 * Erro lançado pelo SDK quando a vesta-api retorna um status HTTP não-2xx,
 * quando a requisição sofre timeout ou quando há falha de rede.
 *
 * - `statusCode > 0` → erro HTTP da API (400, 401, 404, 409, 422, 500…)
 * - `statusCode === 0` → erro de rede ou timeout (sem resposta do servidor)
 *
 * @example
 * try {
 *   await sdk.issueCredential(params);
 * } catch (err) {
 *   if (err instanceof VestaSDKError && err.statusCode === 401) {
 *     console.error('API key inválida');
 *   }
 * }
 */
export class VestaSDKError extends Error {
  /**
   * @param statusCode - Código HTTP da resposta da API (0 para erros de rede/timeout).
   * @param apiMessage - Mensagem de erro extraída do corpo JSON da resposta.
   */
  constructor(
    public readonly statusCode: number,
    public readonly apiMessage: string,
  ) {
    super(`VestaSDK [${statusCode}]: ${apiMessage}`);
    this.name = 'VestaSDKError';
  }
}

// ─── URLs por ambiente ───────────────────────────────────────────────────────

/** Mapa de URLs da API por ambiente. */
const VESTA_URLS: Record<VestaEnvironment, string> = {
  [VestaEnvironment.STAGING]: 'https://vesta.trust-staging.com',
  [VestaEnvironment.PRODUCTION]: 'https://vesta.hous3-trust.com',
};

/** Timeout padrão para requisições POST (60s). */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Resolve a URL base da API a partir da configuração do SDK.
 * @internal Exportado para uso pelo PasskeyService (fetchServerChallenge).
 */
export function resolveBaseUrl(config: VestaSDKConfig): string {
  return VESTA_URLS[config.environment ?? VestaEnvironment.STAGING];
}

// ─── Interface do cliente HTTP ────────────────────────────────────────────────

/**
 * Interface interna do cliente HTTP.
 * Todos os serviços do SDK recebem uma instância desta interface.
 */
export interface HttpClient {
  /**
   * Realiza uma requisição POST para o endpoint especificado.
   *
   * @param path - Caminho relativo ao apiUrl — ex: "/credentials".
   * @param body - Objeto a ser serializado como JSON no corpo da requisição.
   * @returns Promise com a resposta deserializada do tipo `TResponse`.
   * @throws {VestaSDKError} Se a API retornar status não-2xx, timeout ou erro de rede.
   */
  post<TBody, TResponse>(path: string, body: TBody): Promise<TResponse>;
}

// ─── Fábrica do cliente ───────────────────────────────────────────────────────

/**
 * Cria um cliente HTTP pré-configurado para a vesta-api.
 *
 * O cliente injeta automaticamente os headers de autenticação em todas
 * as requisições, aplica timeout via AbortController e lança `VestaSDKError`
 * em respostas não-2xx, timeouts e falhas de rede.
 *
 * @param config - Configuração do SDK com environment, API key e issuer ID opcionais.
 * @returns Objeto com método `post` tipado.
 */
export function createHttpClient(config: VestaSDKConfig): HttpClient {
  const baseUrl = resolveBaseUrl(config);

  return {
    async post<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      };

      if (config.issuerId) {
        headers['X-Vesta-Issuer-ID'] = config.issuerId;
      }

      // Timeout via AbortController — evita que o SDK trave indefinidamente
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new VestaSDKError(
            0,
            `Request timeout — a API não respondeu em ${DEFAULT_TIMEOUT_MS / 1000}s.`,
          );
        }
        throw new VestaSDKError(
          0,
          'Erro de rede — verifique sua conexão com a internet.',
        );
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        let apiMessage = response.statusText;
        try {
          const errorBody = (await response.json()) as { message?: string; error?: string };
          apiMessage = errorBody.message ?? errorBody.error ?? apiMessage;
        } catch {
          // corpo não é JSON — mantém statusText
        }
        throw new VestaSDKError(response.status, apiMessage);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new VestaSDKError(0, 'Resposta inválida da API — corpo não é JSON.');
      }

      // Unwrap { data: ... } envelope used by the Vesta API interceptor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = json as any;
      return (parsed !== null && typeof parsed === 'object' && 'data' in parsed && parsed.data !== undefined
        ? parsed.data
        : parsed) as TResponse;
    },
  };
}
