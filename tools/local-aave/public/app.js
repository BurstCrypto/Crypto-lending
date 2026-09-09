/* global document, window, fetch, AbortController */
const form = document.querySelector('#lookup');
const address = document.querySelector('#address');
const button = document.querySelector('#refresh');
const useWallet = document.querySelector('#use-wallet');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const markets = document.querySelector('#markets');
const walletBalances = document.querySelector('#wallet-balances');
const positions = document.querySelector('#positions');
const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const walletAmount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 9 });
const rate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' });
const settings = {
  ethereum: {
    endpoint: '/api/read',
    placeholder: '0x… or leave blank for markets',
    provider: 'PublicNode and dRPC',
    wallet: 'Use browser Ethereum wallet',
  },
  solana: {
    endpoint: '/api/solana/read',
    placeholder: 'Solana public address, or leave blank for market data',
    provider: 'PublicNode and Solana public RPC',
    wallet: 'Use Phantom wallet',
  },
};
const addresses = { ethereum: '', solana: '' };
let chain = 'ethereum';
let generation = 0;
let currentRead = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metric(label, value, prominent = false) {
  const node = element('div', undefined, prominent ? 'metric prominent' : 'metric');
  node.append(element('span', label), element('strong', value));
  return node;
}
function card(title, subtitle) {
  const node = element('article', undefined, 'market');
  node.append(element('h3', title), element('p', subtitle, 'hint'));
  return node;
}
function renderEthereum(data) {
  for (const asset of data.assets) {
    const node = card(asset.symbol, 'Aave V3 · Ethereum');
    const rates = element('div', undefined, 'rates');
    rates.append(
      metric('Supply APR', `${rate.format(Number(asset.supplyAprPercent))}%`, true),
      metric(
        'Variable borrow APR',
        `${rate.format(Number(asset.variableBorrowAprPercent))}%`,
        true,
      ),
    );
    node.append(
      rates,
      metric('Total supplied', amount.format(Number(asset.totalSupplied))),
      metric('Total variable debt', amount.format(Number(asset.totalVariableDebt))),
      metric('Available liquidity', amount.format(Number(asset.availableLiquidity))),
    );
    if (data.walletAddress !== null) {
      const wallet = element('div', undefined, 'wallet');
      wallet.append(
        metric('Wallet supplied', walletAmount.format(Number(asset.walletSupply))),
        metric('Wallet variable debt', walletAmount.format(Number(asset.walletVariableDebt))),
      );
      node.append(wallet);
    }
    node.append(element('p', `Balances in ${asset.symbol}`, 'hint'));
    markets.append(node);
  }
  document.querySelector('#wallet-note').textContent =
    data.walletAddress === null
      ? 'Enter a public Ethereum address above to include its USDC and USDT positions.'
      : `Wallet lookup: ${data.walletAddress}. These two assets are a partial view, not an account health or liquidation assessment.`;
  document.querySelector('#snapshot-note').textContent =
    'Both Ethereum sources returned matching values at the same finalized block.';
}
function renderSolana(data) {
  const market = card('USDC', 'Kamino Lend · Main market');
  market.append(
    metric('Total supplied, recorded', amount.format(Number(data.market.totalSupplied))),
    metric('Total borrowed, recorded', amount.format(Number(data.market.totalBorrowed))),
    metric('Available liquidity', amount.format(Number(data.market.availableLiquidity))),
    element(
      'p',
      `Reserve last refreshed at slot ${data.market.lastUpdateSlot}. Balances in USDC.`,
      'hint',
    ),
  );
  markets.append(market);
  if (data.walletBalances !== null) {
    walletBalances.hidden = false;
    for (const balance of data.walletBalances)
      walletBalances.append(
        metric(`Wallet ${balance.symbol}`, walletAmount.format(Number(balance.amount)), true),
      );
    positions.hidden = false;
    for (const position of data.positions) {
      const node = card(position.label, 'Kamino main market · USDC only');
      if (position.status === 'NOT_FOUND')
        node.append(element('p', 'This default position account was not found.', 'hint'));
      else
        node.append(
          metric('Supplied USDC, estimated', walletAmount.format(Number(position.suppliedUsdc))),
          metric('Borrowed USDC, estimated', walletAmount.format(Number(position.borrowedUsdc))),
          element('p', `Position last refreshed at slot ${position.lastUpdateSlot}.`, 'hint'),
        );
      positions.append(node);
    }
  }
  document.querySelector('#wallet-note').textContent =
    `${data.walletAddress ? `Wallet lookup: ${data.walletAddress}. ` : 'Enter a Solana public address to read SOL, USDC and USDT balances. '}${data.positionCoverage}`;
  document.querySelector('#snapshot-note').textContent =
    `Matching account data at finalized response slots ${data.contextSlots.join(' and ')}. Solana responses can use different slots. Lending amounts use recorded reserve state and exclude interest accrued since its last refresh. These are not payoff quotes or an account health assessment.`;
}
function render(data) {
  markets.replaceChildren();
  walletBalances.replaceChildren();
  positions.replaceChildren();
  walletBalances.hidden = true;
  positions.hidden = true;
  if (chain === 'solana') renderSolana(data);
  else renderEthereum(data);
  document.querySelector('#block-label').textContent =
    chain === 'solana' ? 'VERIFIED FINALIZED SLOT' : 'FINALIZED BLOCK';
  document.querySelector('#snapshot-heading').textContent =
    chain === 'solana' ? 'Solana wallet & Kamino snapshot' : 'Finalized Aave market snapshot';
  document.querySelector('#agreement').textContent =
    chain === 'solana' ? '● Account data matches' : '● Two endpoints agree';
  document.querySelector('#block-number').textContent = `#${data.block.number}`;
  document.querySelector('#block-time').textContent = time.format(new Date(data.block.timestamp));
  document.querySelector('#observed').textContent = time.format(new Date(data.observedAt));
  document.querySelector('#source-names').textContent = data.sources.join(' + ');
  document.querySelector('#block-hash').textContent = data.block.hash;
  results.hidden = false;
}
async function refresh(event) {
  event?.preventDefault();
  if (button.disabled) return;
  const value = address.value.trim();
  const valid =
    chain === 'ethereum'
      ? /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value)
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && value !== '11111111111111111111111111111111';
  if (value && !valid) {
    status.textContent = `Enter a valid ${chain === 'solana' ? 'Solana base58' : 'Ethereum 0x'} public address.`;
    status.className = 'error';
    results.hidden = true;
    return;
  }
  addresses[chain] = value;
  const readGeneration = ++generation;
  currentRead?.abort();
  currentRead = new AbortController();
  button.disabled = true;
  status.className = '';
  status.textContent = `Reading finalized ${chain === 'solana' ? 'Solana' : 'Ethereum'} data and comparing both RPC endpoints…`;
  results.hidden = true;
  try {
    const response = await fetch(settings[chain].endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: value || null }),
      signal: currentRead.signal,
    });
    const data = await response.json();
    if (readGeneration !== generation) return;
    if (!response.ok) throw new Error(data.error || 'The read failed. Please try again.');
    render(data);
    status.textContent = 'Live read complete. Refresh to update this snapshot.';
  } catch (error) {
    if (readGeneration !== generation) return;
    status.textContent =
      error instanceof Error
        ? error.message
        : 'The local connection is unavailable. Please try again.';
    status.className = 'error';
  } finally {
    if (readGeneration === generation) button.disabled = false;
  }
}
function invalidate() {
  generation++;
  currentRead?.abort();
  button.disabled = false;
  results.hidden = true;
}
for (const choice of document.querySelectorAll('[data-chain]'))
  choice.addEventListener('click', () => {
    if (choice.dataset.chain === chain) return;
    addresses[chain] = address.value.trim();
    invalidate();
    chain = choice.dataset.chain;
    address.value = addresses[chain];
    address.maxLength = chain === 'solana' ? 44 : 42;
    address.placeholder = settings[chain].placeholder;
    useWallet.textContent = settings[chain].wallet;
    for (const item of document.querySelectorAll('[data-chain]'))
      item.setAttribute('aria-pressed', String(item.dataset.chain === chain));
    document.querySelector('#privacy').textContent =
      `A lookup sends this public address to ${settings[chain].provider}. No signature or wallet ownership verification is involved.`;
    void refresh();
  });
address.addEventListener('input', () => {
  invalidate();
  status.textContent = 'Press Refresh live data to look up this address.';
  status.className = '';
});
useWallet.addEventListener('click', async () => {
  const selected = chain;
  const connectionGeneration = generation;
  useWallet.disabled = true;
  try {
    let publicAddress;
    if (selected === 'solana') {
      const provider = window.phantom?.solana;
      if (!provider?.isPhantom || typeof provider.connect !== 'function')
        throw new Error('Wallet unavailable');
      const connection = await provider.connect();
      publicAddress = connection.publicKey?.toString();
    } else {
      if (typeof window.ethereum?.request !== 'function') throw new Error('Wallet unavailable');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      publicAddress = accounts?.[0];
    }
    if (selected !== chain || connectionGeneration !== generation) return;
    if (typeof publicAddress !== 'string')
      throw new Error('Wallet did not return a public address');
    address.value = publicAddress;
    invalidate();
    void refresh();
  } catch {
    if (selected === chain && connectionGeneration === generation) {
      status.textContent =
        'Wallet connection was unavailable or cancelled. You can paste its public address and refresh.';
      status.className = 'error';
    }
  } finally {
    useWallet.disabled = false;
  }
});
form.addEventListener('submit', refresh);
void refresh();
