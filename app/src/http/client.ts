import type { VestaSDKConfig } from '../types';

// ─── Erro tipado da API ────────────────────────────────────────────────────────

/**
 * Erro lançado pelo SDK quando a vesta-api retorna um status HTTP não-2xx.
 *
 * Inclui o `statusCode` HTTP e a `apiMessage` extraída do corpo da resposta,
 * permitindo que o consumidor diferencie erros de validação (400), autenticação
 * (401), não encontrado (404) e erros de servidor (500).
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
   * @param statusCode - Código HTTP da resposta da API.
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
   * @throws {VestaSDKError} Se a API retornar status não-2xx.
   */
  post<TBody, TResponse>(path: string, body: TBody): Promise<TResponse>;
}

// ─── Fábrica do cliente ───────────────────────────────────────────────────────

/**
 * Cria um cliente HTTP pré-configurado para a vesta-api-stellar.
 *
 * O cliente injeta automaticamente os headers de autenticação em todas
 * as requisições e lança `VestaSDKError` em respostas não-2xx.
 *
 * @param config - Configuração do SDK com URL base, API key e issuer ID opcionais.
 * @returns Objeto com método `post` tipado.
 *
 * @example
 * const http = createHttpClient({ apiUrl: 'https://api.vesta.id', apiKey: 'key123' });
 * const response = await http.post<MyBody, MyResponse>('/credentials', body);
 */
/** URL interna da Vesta API. Não faz parte da API pública do SDK. */
export const VESTA_API_URL = 'http://localhost:3000';

export function createHttpClient(config: VestaSDKConfig): HttpClient {
  const baseUrl = VESTA_API_URL;

  return {
    async post<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      };

      if (config.issuerId) {
        headers['X-Vesta-Issuer-ID'] = config.issuerId;
      }

      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

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

      return response.json() as Promise<TResponse>;
    },
  };
}
