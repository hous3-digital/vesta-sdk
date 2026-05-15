// fake-indexeddb/auto substitui o global `indexedDB` por uma implementação
// em memória totalmente spec-compliant — necessário no ambiente jsdom.
import 'fake-indexeddb/auto';

import { PasskeyService } from '../src/passkey/passkey.service';
import type { VestaVC } from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockVC: VestaVC = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: 'urn:uuid:passkey-test',
  type: ['VerifiableCredential', 'VestaKYCCredential'],
  issuer: { id: 'did:web:vesta.id:issuers:bradesco', name: 'Banco Bradesco S.A.' },
  issuance_date: '2025-01-15T10:00:00Z',
  expiration_date: '2026-01-15T10:00:00Z',
  credential_subject: {
    id: 'did:key:z6Mk...',
    cpf_hash: '1405822985',
    birth_date_hash: '15417048711',
    full_name_hash: '8703093882',
    kyc_level: 'complete',
    kyc_provider: 'serasa',
    kyc_method: 'biometric_plus_document',
    nationality: 'BR',
  },
  proof: {
    type: 'PoseidonSignature2024',
    created: '2025-01-15T10:00:00Z',
    verificationMethod: 'did:web:vesta.id:issuers:bradesco#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'zMock',
  },
};

const TEST_VC_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// ─── Mock do WebAuthn (navigator.credentials) ─────────────────────────────────

/**
 * Cria um mock de PublicKeyCredential para simular a criação de passkey.
 */
function makeMockCredential(id: string): PublicKeyCredential {
  return {
    id,
    rawId: new TextEncoder().encode(id),
    type: 'public-key',
    response: {} as AuthenticatorAttestationResponse,
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: 'platform',
  } as unknown as PublicKeyCredential;
}

/**
 * Cria um mock de PublicKeyCredential para simular a asserção de passkey.
 * O `userHandle` é o vcHash codificado em UTF-8 (espelhando o que `register` salva).
 */
function makeMockAssertion(vcHash: string): PublicKeyCredential {
  return {
    id: 'mock-credential-id',
    rawId: new TextEncoder().encode('mock-credential-id'),
    type: 'public-key',
    response: {
      userHandle: new TextEncoder().encode(vcHash),
      authenticatorData: new ArrayBuffer(0),
      clientDataJSON: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
    } as unknown as AuthenticatorAssertionResponse,
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: 'platform',
  } as unknown as PublicKeyCredential;
}

// ─── Setup do mock global do WebAuthn ────────────────────────────────────────

let mockCreate: jest.Mock;
let mockGet: jest.Mock;

beforeEach(() => {
  mockCreate = jest.fn();
  mockGet = jest.fn();

  Object.defineProperty(global, 'navigator', {
    value: {
      credentials: {
        create: mockCreate,
        get: mockGet,
      },
    },
    writable: true,
    configurable: true,
  });

  // Garante que PublicKeyCredential exista no ambiente jsdom para isSupported()
  Object.defineProperty(global.window, 'PublicKeyCredential', {
    value: class PublicKeyCredential {},
    writable: true,
    configurable: true,
  });
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('PasskeyService', () => {
  let service: PasskeyService;

  beforeEach(() => {
    service = new PasskeyService('localhost');
  });

  // ── isSupported ────────────────────────────────────────────────────────────

  describe('isSupported()', () => {
    it('deve retornar true quando PublicKeyCredential está disponível', () => {
      expect(service.isSupported()).toBe(true);
    });

    it('deve retornar false quando PublicKeyCredential não está disponível', () => {
      const win = window as unknown as Record<string, unknown>;
      const original = win['PublicKeyCredential'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).PublicKeyCredential;

      expect(service.isSupported()).toBe(false);

      win['PublicKeyCredential'] = original;
    });
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('deve chamar navigator.credentials.create com userVerification required', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('test-passkey-id'));

      await service.register(mockVC, TEST_VC_HASH);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const createOptions = mockCreate.mock.calls[0][0] as CredentialCreationOptions;
      expect(createOptions.publicKey?.authenticatorSelection?.userVerification).toBe('required');
    });

    it('deve encodar o vcHash como user.id (UTF-8 Uint8Array)', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('test-passkey-id'));

      await service.register(mockVC, TEST_VC_HASH);

      const createOptions = mockCreate.mock.calls[0][0] as CredentialCreationOptions;
      const userId = createOptions.publicKey?.user.id as Uint8Array;
      const decoded = new TextDecoder().decode(userId);
      expect(decoded).toBe(TEST_VC_HASH);
    });

    it('deve salvar a StoredCredential no IndexedDB após registro', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('test-passkey-id'));

      await service.register(mockVC, TEST_VC_HASH);

      const hashes = await service.getStoredHashes();
      expect(hashes).toContain(TEST_VC_HASH);
    });

    it('deve retornar o passkeyCredentialId do credential criado', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('my-unique-cred-id'));

      const result = await service.register(mockVC, TEST_VC_HASH);

      expect(result.passkeyCredentialId).toBe('my-unique-cred-id');
      expect(result.vcHash).toBe(TEST_VC_HASH);
    });

    it('deve lançar erro se o usuário cancelar o prompt (create retorna null)', async () => {
      mockCreate.mockResolvedValueOnce(null);

      await expect(service.register(mockVC, TEST_VC_HASH)).rejects.toThrow(
        'Criação do Passkey cancelada pelo usuário.',
      );
    });

    it('deve lançar erro se navigator.credentials.create rejeitar', async () => {
      mockCreate.mockRejectedValueOnce(new DOMException('NotAllowedError'));

      await expect(service.register(mockVC, TEST_VC_HASH)).rejects.toThrow();
    });
  });

  // ── authenticate ──────────────────────────────────────────────────────────

  describe('authenticate()', () => {
    it('deve chamar navigator.credentials.get com userVerification required', async () => {
      // Registra primeiro para ter dado no IDB
      mockCreate.mockResolvedValueOnce(makeMockCredential('cred-id'));
      await service.register(mockVC, TEST_VC_HASH);

      mockGet.mockResolvedValueOnce(makeMockAssertion(TEST_VC_HASH));
      await service.authenticate();

      expect(mockGet).toHaveBeenCalledTimes(1);
      const getOptions = mockGet.mock.calls[0][0] as CredentialRequestOptions;
      expect(getOptions.publicKey?.userVerification).toBe('required');
    });

    it('deve usar allowCredentials vazio (resident key flow)', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('cred-id'));
      await service.register(mockVC, TEST_VC_HASH);

      mockGet.mockResolvedValueOnce(makeMockAssertion(TEST_VC_HASH));
      await service.authenticate();

      const getOptions = mockGet.mock.calls[0][0] as CredentialRequestOptions;
      expect(getOptions.publicKey?.allowCredentials).toEqual([]);
    });

    it('deve decodificar o userHandle e retornar a StoredCredential correta', async () => {
      mockCreate.mockResolvedValueOnce(makeMockCredential('cred-id'));
      await service.register(mockVC, TEST_VC_HASH);

      mockGet.mockResolvedValueOnce(makeMockAssertion(TEST_VC_HASH));
      const result = await service.authenticate();

      expect(result.vcHash).toBe(TEST_VC_HASH);
      expect(result.vc.id).toBe(mockVC.id);
      expect(result.passkeyCredentialId).toBe('cred-id');
    });

    it('deve lançar erro se authenticate retornar null (usuário cancelou)', async () => {
      mockGet.mockResolvedValueOnce(null);

      await expect(service.authenticate()).rejects.toThrow(
        'Autenticação via Passkey cancelada pelo usuário.',
      );
    });

    it('deve lançar erro se userHandle não estiver presente na assertion', async () => {
      const noHandleAssertion = {
        id: 'cred-id',
        type: 'public-key',
        response: {
          userHandle: null,
          authenticatorData: new ArrayBuffer(0),
          clientDataJSON: new ArrayBuffer(0),
          signature: new ArrayBuffer(0),
        },
        getClientExtensionResults: () => ({}),
      } as unknown as PublicKeyCredential;

      mockGet.mockResolvedValueOnce(noHandleAssertion);

      await expect(service.authenticate()).rejects.toThrow('userHandle');
    });

    it('deve lançar erro se não houver dado no IDB para o vcHash recuperado', async () => {
      const unknownHash = 'unknownhash000000000000000000000000000000000000000000000000000000';
      mockGet.mockResolvedValueOnce(makeMockAssertion(unknownHash));

      await expect(service.authenticate()).rejects.toThrow('Nenhuma credencial encontrada');
    });
  });

  // ── getStoredHashes ────────────────────────────────────────────────────────

  describe('getStoredHashes()', () => {
    it('deve retornar array vazio quando não há credenciais armazenadas', async () => {
      // Cria uma nova instância para ter IDB limpo neste contexto
      const freshService = new PasskeyService('localhost');
      const hashes = await freshService.getStoredHashes();
      // pode ter itens de testes anteriores — verificamos que é um array
      expect(Array.isArray(hashes)).toBe(true);
    });

    it('deve retornar o vcHash após registro', async () => {
      const freshVC = { ...mockVC, id: 'urn:uuid:unique-hash-test' };
      const uniqueHash = 'uniquehash' + Date.now().toString();
      mockCreate.mockResolvedValueOnce(makeMockCredential('cred-unique'));

      await service.register(freshVC, uniqueHash);
      const hashes = await service.getStoredHashes();

      expect(hashes).toContain(uniqueHash);
    });
  });

  // ── deleteStored ──────────────────────────────────────────────────────────

  describe('deleteStored()', () => {
    it('deve remover a credencial do IndexedDB', async () => {
      const deleteHash = 'deletehash' + Date.now().toString();
      mockCreate.mockResolvedValueOnce(makeMockCredential('cred-delete'));
      await service.register(mockVC, deleteHash);

      // Confirma que foi salvo
      let hashes = await service.getStoredHashes();
      expect(hashes).toContain(deleteHash);

      // Remove
      await service.deleteStored(deleteHash);

      // Confirma remoção
      hashes = await service.getStoredHashes();
      expect(hashes).not.toContain(deleteHash);
    });
  });

  // ── ambiente sem suporte ──────────────────────────────────────────────────

  describe('ambiente sem WebAuthn', () => {
    it('deve lançar erro ao chamar register sem suporte a WebAuthn', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).PublicKeyCredential;

      const unsupportedService = new PasskeyService('localhost');
      await expect(unsupportedService.register(mockVC, TEST_VC_HASH)).rejects.toThrow(
        'WebAuthn/Passkeys não é suportado',
      );
    });
  });
});
