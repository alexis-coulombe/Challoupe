import * as client from 'openid-client';
import type { Request, Response } from 'express';
import { userRepository } from '../../auth.js';
import { auditLog } from '../../audit.js';
import { settingsService } from '../../settings.js';
import { PUBLIC_URL } from '../../config.js';
import { oidcConfigProvider } from './oidc.js';

function callbackUrl(req: Request): string {
  return `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/api/auth/oidc/callback`;
}

export class OidcController {
  // Public: lets the login page know whether to show an SSO button, without exposing
  // the issuer/client configuration itself.
  config = (_req: Request, res: Response): void => {
    const { oidc } = settingsService.get();
    res.json({ enabled: !!(oidc.enabled && oidc.issuerUrl && oidc.clientId), buttonLabel: oidc.buttonLabel });
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const config = await oidcConfigProvider.get();
    if (!config) {
      res.status(400).json({ error: 'Single sign-on is not configured' });
      return;
    }
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    req.session.oidc = { state, nonce, codeVerifier };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl(req),
      scope: 'openid profile email',
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(url.href);
  };

  callback = async (req: Request, res: Response): Promise<void> => {
    const saved = req.session.oidc;
    const config = saved ? await oidcConfigProvider.get() : null;
    if (!config || !saved) {
      res.redirect('/login?error=oidc_failed');
      return;
    }
    delete req.session.oidc;
    try {
      const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: saved.codeVerifier,
        expectedState: saved.state,
        expectedNonce: saved.nonce,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('The identity provider did not return an ID token');
      const username = String(claims.email ?? claims.preferred_username ?? claims.sub);
      const user = userRepository.findOrCreateOidc(username);
      req.session.regenerate((err) => {
        if (err) throw err;
        req.session.userId = user.id;
        auditLog.record({
          userId: user.id,
          username: user.username,
          action: 'auth.oidc_login',
          status: 'success',
          ip: req.ip,
        });
        res.redirect('/');
      });
    } catch (err) {
      auditLog.record({
        userId: null,
        username: 'unknown',
        action: 'auth.oidc_login',
        status: 'failure',
        detail: (err as Error).message,
        ip: req.ip,
      });
      res.redirect('/login?error=oidc_failed');
    }
  };
}

export const oidcController = new OidcController();
