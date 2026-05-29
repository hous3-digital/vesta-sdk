import type { PasskeyRegistrationResult, StoredCredential, VestaVC } from '../types';
import { VestaSDKError } from '../http/client';

/** Nome do banco IndexedDB usado pelo SDK. */
const DB_NAME = 'vesta-sdk';
/** Nome do object store dentro do banco. */
const STORE_NAME = 'credentials';
/** Versão do schema do IndexedDB. */
const DB_VERSION = 1;

/**
 * Serviço responsável pelo armazenamento seguro de Credenciais Verificáveis
 * no dispositivo do usuário, protegido por autenticação WebAuthn (Passkey).
 *
 * ## Como funciona
 * - A VC é armazenada em **IndexedDB** (banco local do browser).
 * - Um **WebAuthn credential (Passkey)** é criado com `user.id = vcHash`.
 * - Para recuperar a VC, o usuário precisa autenticar via Passkey (biometria, PIN, etc.).
 * - A assertion de autenticação retorna o `userHandle` (= vcHash), que é usado
 *   para buscar a VC no IndexedDB.
 *
 * ## Por que IndexedDB + WebAuthn separados?
 * O protocolo WebAuthn não permite armazenar dados arbitrários no autenticador.
 * O Passkey serve exclusivamente como gate de autenticação — garante presença
 * física e consentimento do usuário antes de liberar acesso à VC.
 *
 * @internal Não instanciar diretamente — use o `VestaSDK` como ponto de entrada.
 */
/** Timeout para a requisição de challenge (10s). */
const CHALLENGE_TIMEOUT_MS = 10_000;

export class PasskeyService {
  private readonly rpId: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  /**
   * @param rpId - Relying Party ID para WebAuthn.
   *   Deve ser igual ao domínio atual (ou um sufixo registrável).
   *   Padrão: `window.location.hostname` (ou `'localhost'` em testes).
   * @param baseUrl - URL base da API Vesta (resolvida a partir do environment).
   * @param apiKey - API key para autenticação nas requisições ao servidor.
   */
  constructor(rpId: string | undefined, baseUrl: string, apiKey: string) {
    this.rpId =
      rpId ??
      (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // ─── API pública ─────────────────────────────────────────────────────────

  /**
   * Verifica se o dispositivo e browser suportam WebAuthn/Passkeys.
   *
   * Deve ser chamado antes de qualquer operação de registro ou autenticação
   * para fornecer feedback adequado ao usuário.
   *
   * @returns `true` se `PublicKeyCredential` estiver disponível no browser.
   *
   * @example
   * if (!sdk.isPasskeySupported()) {
   *   alert('Seu browser não suporta Passkeys. Use Chrome, Safari ou Edge.');
   * }
   */
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined'
    );
  }

  /**
   * Registra um Passkey para a credencial fornecida e salva a VC no IndexedDB.
   *
   * O processo:
   * 1. Solicita ao autenticador do dispositivo a criação de um novo credential.
   * 2. O `user.id` do credential é definido como `vcHash` (encodado em bytes).
   * 3. A VC é persistida no IndexedDB com o `passkeyCredentialId` associado.
   *
   * O browser exibirá o prompt nativo de criação de Passkey (Touch ID, Face ID,
   * Windows Hello, PIN, etc.).
   *
   * @param vc - Credencial Verificável a ser armazenada.
   * @param vcHash - Hash SHA-256 da VC — usado como `user.id` no WebAuthn e chave no IndexedDB.
   * @returns ID do WebAuthn credential criado e o vcHash associado.
   * @throws {Error} Se o usuário cancelar o prompt do autenticador.
   * @throws {Error} Se o browser não suportar WebAuthn.
   * @throws {Error} Se o IndexedDB não estiver disponível.
   *
   * @example
   * const { passkeyCredentialId } = await passkeyService.register(vc, vcHash);
   * console.log('Passkey criado:', passkeyCredentialId);
   */
  async register(vc: VestaVC, vcHash: string): Promise<PasskeyRegistrationResult> {
    this.assertSupported();

    const challenge = crypto.getRandomValues(new Uint8Array(16));
    // user.id deve ser um BufferSource — codificamos o vcHash como UTF-8 (64 bytes para SHA-256 hex)
    const userId = new TextEncoder().encode(vcHash);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          id: this.rpId,
          name: 'Vesta Digital Passport',
        },
        user: {
          id: userId,
          name: `${vcHash.slice(0, 16)}...`,
          displayName: 'Vesta KYC Credential',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256 (ECDSA P-256)
          { alg: -257, type: 'public-key' },  // RS256 (RSA) — fallback
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        timeout: 60000,
      },
    });

    if (!credential) {
      throw new Error('Criação do Passkey cancelada pelo usuário.');
    }

    const passkeyCredentialId = credential.id;

    const stored: StoredCredential = {
      vc,
      vcHash,
      storedAt: new Date().toISOString(),
      passkeyCredentialId,
    };

    const db = await this.openDB();
    await this.dbPut(db, stored);
    db.close();

    return { passkeyCredentialId, vcHash };
  }

  /**
   * Autentica o usuário via Passkey e retorna a VC armazenada.
   *
   * O processo:
   * 1. Solicita ao autenticador a assinatura de um challenge aleatório.
   * 2. A assertion retorna o `userHandle`, que é o `vcHash` definido no registro.
   * 3. O vcHash é decodificado e usado para buscar a VC no IndexedDB.
   *
   * O browser exibirá o prompt nativo de autenticação (biometria, PIN, etc.).
   * Com `allowCredentials: []`, o autenticador apresenta todos os Passkeys
   * registrados para este domínio — o usuário seleciona o desejado.
   *
   * @returns StoredCredential completo (VC + vcHash + metadados).
   * @throws {Error} Se o usuário cancelar o prompt de autenticação.
   * @throws {Error} Se o `userHandle` não for encontrado na assertion.
   * @throws {Error} Se não houver VC armazenada para o vcHash recuperado.
   *
   * @example
   * const stored = await passkeyService.authenticate();
   * console.log('VC recuperada:', stored.vc.id);
   * console.log('vcHash:', stored.vcHash);
   */
  async authenticate(): Promise<StoredCredential> {
    this.assertSupported();

    // Busca challenge do servidor (anti-replay: de uso único, expira em 60s).
    const serverChallenge = await this.fetchServerChallenge();
    const challengeHex: string = serverChallenge;
    const bytes = new Uint8Array(
      serverChallenge.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    const challengeBuffer = bytes.buffer as ArrayBuffer;

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuffer,
        rpId: this.rpId,
        // allowCredentials vazio = resident key flow:
        // o autenticador apresenta todos os passkeys registrados para este RP
        allowCredentials: [],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    if (!assertion) {
      throw new Error('Autenticação via Passkey cancelada pelo usuário.');
    }

    // A assertion é um PublicKeyCredential com response do tipo AuthenticatorAssertionResponse
    const assertionResponse = (assertion as PublicKeyCredential)
      .response as AuthenticatorAssertionResponse;

    if (!assertionResponse.userHandle) {
      throw new Error(
        'Passkey não retornou userHandle. Certifique-se de que o credential ' +
        'foi criado com residentKey e userVerification habilitados.',
      );
    }

    // userHandle = vcHash encodado em UTF-8 durante o registro
    const vcHash = new TextDecoder().decode(assertionResponse.userHandle);

    const db = await this.openDB();
    const stored = await this.dbGet<StoredCredential>(db, vcHash);
    db.close();

    if (!stored) {
      throw new Error(
        `Nenhuma credencial encontrada para vcHash "${vcHash.slice(0, 16)}...". ` +
        'A credencial pode ter sido removida do dispositivo.',
      );
    }

    // Inclui o challenge usado para que o chamador possa enviá-lo à API
    // para verificação anti-replay em /proofs/generate-and-submit.
    return { ...stored, challengeUsed: challengeHex };
  }

  /**
   * Retorna os vcHashes de todas as credenciais armazenadas no dispositivo.
   *
   * Útil para listar credenciais disponíveis sem acionar autenticação.
   *
   * @returns Array de strings com os vcHashes armazenados.
   * @throws {Error} Se o IndexedDB não estiver disponível.
   *
   * @example
   * const hashes = await passkeyService.getStoredHashes();
   * console.log(`${hashes.length} credencial(is) armazenada(s).`);
   */
  async getStoredHashes(): Promise<string[]> {
    const db = await this.openDB();
    const keys = await this.dbGetAllKeys(db);
    db.close();
    return keys;
  }

  /**
   * Remove uma credencial armazenada do IndexedDB pelo seu vcHash.
   *
   * Atenção: esta operação remove apenas o armazenamento local.
   * O WebAuthn credential no autenticador do dispositivo não é removido —
   * o usuário deve removê-lo manualmente nas configurações do dispositivo.
   *
   * @param vcHash - Hash SHA-256 da VC a ser removida.
   * @throws {Error} Se o IndexedDB não estiver disponível.
   *
   * @example
   * await passkeyService.deleteStored('a1b2c3...');
   */
  async deleteStored(vcHash: string): Promise<void> {
    const db = await this.openDB();
    await this.dbDelete(db, vcHash);
    db.close();
  }

  // ─── Helpers privados — IndexedDB ────────────────────────────────────────

  /**
   * Abre (ou cria) o banco IndexedDB do SDK.
   * Cria o object store `credentials` na primeira execução (onupgradeneeded).
   *
   * @returns Instância do IDBDatabase pronta para uso.
   * @throws {Error} Se o IndexedDB não estiver disponível no ambiente.
   */
  private openDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new Error('VestaSDK: IndexedDB não está disponível neste ambiente.'),
      );
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'vcHash' });
        }
      };

      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });
  }

  /**
   * Lê um registro do object store pelo key.
   *
   * @param db - Instância aberta do IDBDatabase.
   * @param key - Chave do registro (vcHash).
   * @returns O registro encontrado ou `undefined` se não existir.
   */
  private dbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = (): void => resolve(request.result as T | undefined);
      request.onerror = (): void => reject(request.error);
    });
  }

  /**
   * Insere ou atualiza um registro no object store.
   *
   * @param db - Instância aberta do IDBDatabase.
   * @param value - Objeto a persistir. Deve conter o campo `vcHash` (keyPath).
   */
  private dbPut<T>(db: IDBDatabase, value: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void => reject(request.error);
    });
  }

  /**
   * Remove um registro do object store pelo key.
   *
   * @param db - Instância aberta do IDBDatabase.
   * @param key - Chave do registro a remover (vcHash).
   */
  private dbDelete(db: IDBDatabase, key: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void => reject(request.error);
    });
  }

  /**
   * Retorna todas as chaves armazenadas no object store.
   *
   * @param db - Instância aberta do IDBDatabase.
   * @returns Array com todos os vcHashes presentes no store.
   */
  private dbGetAllKeys(db: IDBDatabase): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = (): void => resolve(request.result as string[]);
      request.onerror = (): void => reject(request.error);
    });
  }

  // ─── Challenge server-side ────────────────────────────────────────────────

  /**
   * Busca um challenge de uso único do servidor Vesta.
   *
   * O challenge é gerado com 32 bytes de entropia, armazenado com TTL de 60s
   * e destruído após a primeira verificação — prevenindo replay attacks.
   *
   * @returns Challenge como string hexadecimal (64 chars).
   * @throws {Error} Se a requisição ao servidor falhar.
   */
  private async fetchServerChallenge(): Promise<string> {
    const url = `${this.baseUrl}/public/auth/challenge`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHALLENGE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'X-Api-Key': this.apiKey },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new VestaSDKError(
          0,
          `Timeout ao buscar challenge do servidor (${CHALLENGE_TIMEOUT_MS / 1000}s).`,
        );
      }
      throw new VestaSDKError(
        0,
        'Erro de rede ao buscar challenge — verifique sua conexão com a internet.',
      );
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new VestaSDKError(
        response.status,
        `Falha ao buscar challenge do servidor (${response.status}).`,
      );
    }

    const json = (await response.json()) as
      | { data: { challenge: string; expiresAt: number } }
      | { challenge: string; expiresAt: number };
    const data = 'data' in json ? json.data : json;

    if (!data.challenge || typeof data.challenge !== 'string') {
      throw new VestaSDKError(0, 'Resposta inválida do endpoint de challenge.');
    }

    return data.challenge;
  }

  // ─── Guard ───────────────────────────────────────────────────────────────

  /**
   * Lança um erro se WebAuthn não estiver disponível no ambiente atual.
   *
   * @throws {Error} Se `PublicKeyCredential` não existir no `window`.
   */
  private assertSupported(): void {
    if (!this.isSupported()) {
      throw new Error(
        'VestaSDK: WebAuthn/Passkeys não é suportado neste browser ou ambiente. ' +
        'Verifique com `sdk.isPasskeySupported()` antes de chamar este método.',
      );
    }
  }
}
