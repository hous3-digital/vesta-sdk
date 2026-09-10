import { AttestationsService } from '../src/attestations/attestations.service';
import { VestaSDKError } from '../src/http/client';
import type { HttpClient } from '../src/http/client';
import type { AttestationIssuerResolutionResponse } from '../src/types';

const resolution: AttestationIssuerResolutionResponse = {
  attestationId: 'attestation_01m1z7rca0eh58z3gr34v1vgf6',
  issuer: {
    did: 'did:pkh:stellar:testnet:GISSUER',
    registryStatus: 'ACTIVE',
    active: true,
    roles: ['TECHNICAL', 'COMMERCIAL'],
    payoutAddress: 'GISSUER',
    commissionTerms: [
      { role: 'TECHNICAL', shareBps: 6000 },
      { role: 'COMMERCIAL', shareBps: 4000 },
    ],
    authorizedCredentialTypes: ['VestaKYCCredential'],
  },
};

describe('AttestationsService', () => {
  it('resolve o issuer público pela attestation com o ID codificado na URL', async () => {
    const get = jest.fn().mockResolvedValueOnce(resolution);
    const service = new AttestationsService({ get, post: jest.fn() } as HttpClient);

    const result = await service.resolveIssuer('attestation/a b');

    expect(get).toHaveBeenCalledWith('/public/attestations/attestation%2Fa%20b/issuer');
    expect(result).toEqual(resolution);
    expect(result.issuer).not.toHaveProperty('issuerId');
  });

  it('propaga o 503 quando o registry Soroban está indisponível', async () => {
    const get = jest.fn().mockRejectedValueOnce(new VestaSDKError(503, 'Issuer Registry Unavailable'));
    const service = new AttestationsService({ get, post: jest.fn() } as HttpClient);

    await expect(service.resolveIssuer('attestation_unavailable')).rejects.toMatchObject({
      statusCode: 503,
      apiMessage: 'Issuer Registry Unavailable',
    });
  });
});
