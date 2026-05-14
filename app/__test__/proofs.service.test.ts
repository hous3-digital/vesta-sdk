import { ProofsService } from '../src/proofs/proofs.service';
import { VestaSDKError } from '../src/http/client';
import type { HttpClient } from '../src/http/client';
import type {
  GenerateAndSubmitResponse,
  Groth16Proof,
  SubmitProofRequest,
  VestaVC,
} from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockVC: VestaVC = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: 'urn:uuid:test-456',
  type: ['VerifiableCredential', 'VestaKYCCredential'],
  issuer: { id: 'did:web:vesta.id:issuers:bradesco', name: 'Banco Bradesco S.A.' },
  issuance_date: '2025-01-15T10:00:00Z',
  expiration_date: '2026-01-15T10:00:00Z',
  credential_subject: {
    id: 'did:key:z6Mk...',
    cpf_hash: '1405822985',
    birth_date_hash: '15417048711',
    full_name_hash: '8703093882',
    kyc_level: 'intermediate',
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

const mockGenerateResponse: GenerateAndSubmitResponse = {
  verified: true,
  zkProof: {
    protocol: 'groth16',
    curve: 'bn128',
    publicSignals: ['2', '1'],
    proofHash: 'proof-hash-abc',
    mock: true,
  },
  stellar: {
    txHash: 'MOCK_TX_123',
    ledger: 0,
    contractId: 'PLACEHOLDER',
    network: 'stellar:soroban:testnet',
    mock: true,
  },
  attestation: {
    id: 'attest-001',
    vcHash: 'abc123hash',
    verifierId: 'verifier_bradesco',
    kycLevel: 'intermediate',
    createdAt: '2025-01-15T10:00:00Z',
  },
};

function makeHttpClient(postImpl: jest.Mock): HttpClient {
  return { post: postImpl };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('ProofsService', () => {
  let mockPost: jest.Mock;
  let service: ProofsService;

  beforeEach(() => {
    mockPost = jest.fn();
    service = new ProofsService(makeHttpClient(mockPost));
  });

  // ── generateAndSubmit ──────────────────────────────────────────────────────

  describe('generateAndSubmit()', () => {
    const privateInputs = { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' };

    it('deve chamar POST /proofs/generate-and-submit com vc, vcHash e privateInputs', async () => {
      mockPost.mockResolvedValueOnce(mockGenerateResponse);

      const result = await service.generateAndSubmit(
        mockVC,
        'abc123hash',
        privateInputs,
        'verifier_bradesco',
        2,
      );

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        '/proofs/generate-and-submit',
        expect.objectContaining({
          vc: mockVC,
          vcHash: 'abc123hash',
          privateInputs,
          verifierId: 'verifier_bradesco',
          minKycLevel: 2,
        }),
      );
      expect(result.verified).toBe(true);
    });

    it('deve incluir subjectDid quando fornecido', async () => {
      mockPost.mockResolvedValueOnce(mockGenerateResponse);

      await service.generateAndSubmit(
        mockVC,
        'abc123hash',
        privateInputs,
        'verifier_bradesco',
        2,
        'did:key:z6MkSubject',
      );

      expect(mockPost).toHaveBeenCalledWith(
        '/proofs/generate-and-submit',
        expect.objectContaining({ subjectDid: 'did:key:z6MkSubject' }),
      );
    });

    it('não deve incluir subjectDid quando omitido', async () => {
      mockPost.mockResolvedValueOnce(mockGenerateResponse);

      await service.generateAndSubmit(mockVC, 'abc123hash', privateInputs, 'verifier_bradesco', 2);

      const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('subjectDid');
    });

    it('deve propagar VestaSDKError 400 quando nível de KYC for insuficiente', async () => {
      mockPost.mockRejectedValueOnce(
        new VestaSDKError(400, 'KYC level insufficient: required 3, got 2'),
      );

      await expect(
        service.generateAndSubmit(mockVC, 'abc123hash', privateInputs, 'verifier_bradesco', 3),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deve propagar VestaSDKError 422 para VC expirada', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(422, 'Credential is expired'));

      await expect(
        service.generateAndSubmit(mockVC, 'abc123hash', privateInputs, 'verifier_bradesco', 2),
      ).rejects.toMatchObject({ statusCode: 422, apiMessage: 'Credential is expired' });
    });
  });

  // ── submit ─────────────────────────────────────────────────────────────────

  describe('submit()', () => {
    const mockProof: Groth16Proof = {
      pi_a: ['1', '2', '1'],
      pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
      pi_c: ['7', '8', '1'],
      protocol: 'groth16',
      curve: 'bn128',
    };

    const submitReq: SubmitProofRequest = {
      proof: mockProof,
      publicSignals: ['2', '1'],
      verifierId: 'verifier_bradesco',
      vcHash: 'abc123hash',
      minKycLevel: 2,
    };

    it('deve chamar POST /proofs/submit com o payload completo', async () => {
      mockPost.mockResolvedValueOnce(mockGenerateResponse);

      const result = await service.submit(submitReq);

      expect(mockPost).toHaveBeenCalledWith('/proofs/submit', submitReq);
      expect(result.verified).toBe(true);
    });

    it('deve propagar VestaSDKError 404 se a credencial não existir', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(404, 'Credential not found'));

      await expect(service.submit(submitReq)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('deve propagar VestaSDKError 401 para API key inválida', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(401, 'Unauthorized'));

      await expect(service.submit(submitReq)).rejects.toMatchObject({ statusCode: 401 });
    });
  });
});
