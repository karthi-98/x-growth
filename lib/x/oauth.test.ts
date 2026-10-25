import { describe, expect, test } from "bun:test"

import { hmacSha1Signature, oauthHeader, percentEncode, signatureBaseString } from "./oauth"

// X's documented example: https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
const EXAMPLE = {
  method: "POST",
  url: "https://api.x.com/1.1/statuses/update.json",
  params: {
    status: "Hello Ladies + Gentlemen, a signed OAuth request!",
    include_entities: "true",
    oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
    oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: "1318622958",
    oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    oauth_version: "1.0",
  },
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  baseString:
    "POST&https%3A%2F%2Fapi.x.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
  signature: "Ls93hJiZbQ3akF3HF3x1Bz8/zU4=",
}

describe("OAuth 1.0a signing", () => {
  test("percent-encodes per RFC 3986", () => {
    expect(percentEncode("Ladies + Gentlemen!")).toBe("Ladies%20%2B%20Gentlemen%21")
    expect(percentEncode("a*b'c(d)")).toBe("a%2Ab%27c%28d%29")
    expect(percentEncode("☃")).toBe("%E2%98%83")
    expect(percentEncode("-._~")).toBe("-._~")
  })

  test("builds X's documented signature base string", () => {
    expect(signatureBaseString(EXAMPLE.method, EXAMPLE.url, EXAMPLE.params)).toBe(EXAMPLE.baseString)
  })

  test("matches X's documented signature", () => {
    expect(hmacSha1Signature(EXAMPLE.baseString, EXAMPLE.consumerSecret, EXAMPLE.tokenSecret)).toBe(EXAMPLE.signature)
  })

  test("Authorization header carries the same signature", () => {
    const header = oauthHeader({
      method: "POST",
      url: `${EXAMPLE.url}?include_entities=true`,
      params: { status: EXAMPLE.params.status },
      keys: {
        apiKey: EXAMPLE.params.oauth_consumer_key,
        apiSecret: EXAMPLE.consumerSecret,
        accessToken: EXAMPLE.params.oauth_token,
        accessTokenSecret: EXAMPLE.tokenSecret,
      },
      nonce: EXAMPLE.params.oauth_nonce,
      timestamp: EXAMPLE.params.oauth_timestamp,
    })
    expect(header.startsWith("OAuth ")).toBe(true)
    expect(header).toContain(`oauth_signature="${percentEncode(EXAMPLE.signature)}"`)
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"')
    expect(header).toContain('oauth_version="1.0"')
    // Query and body params are signed but never sent in the header.
    expect(header).not.toContain("status=")
    expect(header).not.toContain("include_entities")
  })

  test("random nonce and current timestamp by default", () => {
    const keys = { apiKey: "k", apiSecret: "s", accessToken: "1-t", accessTokenSecret: "ts" }
    const a = oauthHeader({ method: "GET", url: "https://api.x.com/2/users/me", keys })
    const b = oauthHeader({ method: "GET", url: "https://api.x.com/2/users/me", keys })
    expect(a).not.toBe(b)
    const ts = Number(a.match(/oauth_timestamp="(\d+)"/)![1])
    expect(Math.abs(ts - Date.now() / 1000)).toBeLessThan(5)
  })
})
