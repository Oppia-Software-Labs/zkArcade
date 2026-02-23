// Runtime config: overwritten by deploy/setup with deployment.json values
(function () {
  globalThis.__STELLAR_GAME_STUDIO_CONFIG__ = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractIds: {
      'wordle': '',
      'mock-game-hub': ''
    }
  };
})();
