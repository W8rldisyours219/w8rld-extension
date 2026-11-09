// Independent security expectation; never loaded into the extension.
export const extensionVersion = '0.2.0';
export const optionalFactHosts = ['https://w8rldisyours.com/*', 'https://friends.roblox.com/*', 'https://users.roblox.com/*', 'https://groups.roblox.com/*', 'https://games.roblox.com/*', 'https://apis.roblox.com/*'];
export const contentMatches = ['https://www.roblox.com/home', 'https://www.roblox.com/search/users*', 'https://www.roblox.com/trades*', 'https://www.roblox.com/catalog', 'https://www.roblox.com/catalog?*', 'https://www.roblox.com/catalog/*',
  'https://www.roblox.com/users/*/inventory*', 'https://www.roblox.com/users/inventory*', 'https://www.roblox.com/users/*/profile*', 'https://www.roblox.com/users/*/friends*', 'https://www.roblox.com/users/friends*',
  'https://www.roblox.com/my/avatar*', 'https://www.roblox.com/communities/*', 'https://www.roblox.com/groups/*',
  'https://www.roblox.com/games/*', 'https://www.roblox.com/transactions*', 'https://www.roblox.com/my/account*'];
export const contentScripts = [{ matches: contentMatches, js: ['content.js'], css: ['overlay.css'], run_at: 'document_idle' }];
