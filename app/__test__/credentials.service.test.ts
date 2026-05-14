import { CredentialsService } from '../src/credentials/credentials.service';
import { VestaSDKError } from '../src/http/client';
import type { HttpClient } from '../src/http/client';
import type {
  IssueCredentialRequest,
  IssueCredentialResponse,
  RevokeCredentialRequest,
  RevokeCredentialResponse,
  VestaVC,
  VerifyCredentialRequest,
  VerifyCredentialResponse,
} from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockVC: VestaVC = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: 'urn:uuid:test-123',
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

const mockIssueResponse: IssueCredentialResponse = {
  vc: mockVC,
  vcHash: 'abc123hash',
  credentialId: 'cred-001',
  status: 'approved',
  expiresAt: '2026-01-15T10:00:00Z',
  alreadyExisted: false,
};

// ─── Helper — cria um HttpClient mockado ──────────────────────────────────────

function makeHttpClient(postImpl: jest.Mock): HttpClient {
  return { post: postImpl };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('CredentialsService', () => {
  let mockPost: jest.Mock;
  let service: CredentialsService;

  beforeEach(() => {
    mockPost = jest.fn();
    service = new CredentialsService(makeHttpClient(mockPost));
  });

  // ── issue ──────────────────────────────────────────────────────────────────

  describe('issue()', () => {
    const issueReq: IssueCredentialRequest = {
      cpf: '12345678900',
      fullName: 'João da Silva',
      birthDate: '1990-03-15',
      kycLevel: 'complete',
      kycMethod: 'biometric_plus_document',
    };

    it('deve chamar POST /credentials com o payload correto', async () => {
      mockPost.mockResolvedValueOnce(mockIssueResponse);

      const result = await service.issue(issueReq);

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith('/credentials', issueReq);
      expect(result).toEqual(mockIssueResponse);
    });

    it('deve retornar alreadyExisted=true na re-emissão', async () => {
      const reissueResponse = { ...mockIssueResponse, alreadyExisted: true };
      mockPost.mockResolvedValueOnce(reissueResponse);

      const result = await service.issue(issueReq);

      expect(result.alreadyExisted).toBe(true);
    });

    it('deve propagar VestaSDKError em caso de API key inválida (401)', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(401, 'Unauthorized'));

      await expect(service.issue(issueReq)).rejects.toThrow(VestaSDKError);
    });

    it('deve incluir statusCode 401 no erro de autenticação', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(401, 'Unauthorized'));

      await expect(service.issue(issueReq)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('deve propagar VestaSDKError em caso de dados inválidos (400)', async () => {
      mockPost.mockRejectedValueOnce(
        new VestaSDKError(400, 'cpf must be a string'),
      );

      await expect(service.issue(issueReq)).rejects.toMatchObject({
        statusCode: 400,
        apiMessage: 'cpf must be a string',
      });
    });
  });

  // ── verify ─────────────────────────────────────────────────────────────────

  describe('verify()', () => {
    const verifyReq: VerifyCredentialRequest = { vcHash: 'abc123hash' };

    it('deve chamar POST /credentials/verify com vcHash', async () => {
      const validResponse: VerifyCredentialResponse = {
        valid: true,
        vcHash: 'abc123hash',
        kycLevel: 'complete',
        issuerId: 'bradesco',
        expiresAt: '2026-01-15T10:00:00Z',
        challengeNonce: 'nonce-uuid',
      };
      mockPost.mockResolvedValueOnce(validResponse);

      const result = await service.verify(verifyReq);

      expect(mockPost).toHaveBeenCalledWith('/credentials/verify', verifyReq);
      expect(result.valid).toBe(true);
      expect(result.challengeNonce).toBe('nonce-uuid');
    });

    it('deve retornar valid=false com reason para credencial revogada', async () => {
      const revokedResponse: VerifyCredentialResponse = {
        valid: false,
        vcHash: 'abc123hash',
        reason: 'revoked',
      };
      mockPost.mockResolvedValueOnce(revokedResponse);

      const result = await service.verify(verifyReq);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });

    it('deve propagar VestaSDKError 404 se a credencial não existir', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(404, 'Credential not found'));

      await expect(service.verify(verifyReq)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── revoke ─────────────────────────────────────────────────────────────────

  describe('revoke()', () => {
    const revokeReq: RevokeCredentialRequest = {
      vcHash: 'abc123hash',
      reason: 'fraudulent_documents',
    };

    it('deve chamar POST /credentials/revoke com payload completo', async () => {
      const revokeResponse: RevokeCredentialResponse = {
        success: true,
        vcHash: 'abc123hash',
        status: 'revoked',
        reason: 'fraudulent_documents',
      };
      mockPost.mockResolvedValueOnce(revokeResponse);

      const result = await service.revoke(revokeReq);

      expect(mockPost).toHaveBeenCalledWith('/credentials/revoke', revokeReq);
      expect(result.success).toBe(true);
      expect(result.status).toBe('revoked');
    });

    it('deve aceitar revogação sem motivo (reason omitido)', async () => {
      const reqSemMotivo: RevokeCredentialRequest = { vcHash: 'abc123hash' };
      mockPost.mockResolvedValueOnce({ success: true, vcHash: 'abc123hash', status: 'revoked', reason: null });

      await service.revoke(reqSemMotivo);

      expect(mockPost).toHaveBeenCalledWith('/credentials/revoke', reqSemMotivo);
    });

    it('deve propagar VestaSDKError 400 para credencial já revogada', async () => {
      mockPost.mockRejectedValueOnce(new VestaSDKError(400, 'Credential already revoked'));

      await expect(service.revoke(revokeReq)).rejects.toMatchObject({
        statusCode: 400,
        apiMessage: 'Credential already revoked',
      });
    });
  });
});
