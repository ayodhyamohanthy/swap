
describe('server-only transitions (docs/03 machine in the database)', () => {
  it('revokes client UPDATE on requests and offers', () => {
    expect(SCHEMA).toMatch(/REVOKE UPDATE ON TABLE public\.swap_requests FROM authenticated/i)
    expect(SCHEMA).toMatch(/REVOKE UPDATE ON TABLE public\.swap_offers FROM authenticated/i)
  })

  it('moves states only through role-checked RPCs', () => {
    expect(SCHEMA).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_request_transition/si)
    expect(SCHEMA).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_offer_transition/si)
    expect(SCHEMA).toMatch(/is_request_party\(p_req, auth\.uid\(\)\)/i)
    expect(SCHEMA).toMatch(/auth\.role\(\) <> 'service_role'/i)
    expect(SCHEMA).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_request_transition/si)
    expect(SCHEMA).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_offer_transition/si)
  })

  it('pauses users only through the admin-checked RPC', () => {
    expect(SCHEMA).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_set_paused/si)
    expect(SCHEMA).toMatch(/has_role\(auth\.uid\(\), 'admin'\)/i)
  })
})
