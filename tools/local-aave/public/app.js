/* global document, fetch */
const form = document.querySelector('#lookup');
const address = document.querySelector('#address');
const button = document.querySelector('#refresh');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const markets = document.querySelector('#markets');
const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const walletAmount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const rate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' });

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

function render(data) {
  markets.replaceChildren();
  for (const asset of data.assets) {
    const card = element('article', undefined, 'market');
    card.append(element('h3', asset.symbol), element('p', 'Aave V3 · Ethereum', 'hint'));
    const rates = element('div', undefined, 'rates');
    rates.append(
      metric('Supply APR', `${rate.format(Number(asset.supplyAprPercent))}%`, true),
      metric(
        'Variable borrow APR',
        `${rate.format(Number(asset.variableBorrowAprPercent))}%`,
        true,
      ),
    );
    card.append(
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
      card.append(wallet);
    }
    card.append(element('p', `Balances in ${asset.symbol}`, 'hint'));
    markets.append(card);
  }
  document.querySelector('#block-number').textContent = `#${data.block.number}`;
  document.querySelector('#block-time').textContent = time.format(new Date(data.block.timestamp));
  document.querySelector('#observed').textContent = time.format(new Date(data.observedAt));
  document.querySelector('#block-hash').textContent = data.block.hash;
  document.querySelector('#wallet-note').textContent =
    data.walletAddress === null
      ? 'Enter a public Ethereum address above to include its USDC and USDT positions.'
      : `Wallet lookup: ${data.walletAddress}. These two assets are a partial view, not an account health or liquidation assessment.`;
  results.hidden = false;
}

async function refresh(event) {
  event?.preventDefault();
  if (button.disabled) return;
  const value = address.value.trim();
  if (value && (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value))) {
    status.textContent =
      'Enter a nonzero Ethereum address: 0x followed by 40 hexadecimal characters.';
    status.className = 'error';
    results.hidden = true;
    return;
  }
  button.disabled = true;
  status.className = '';
  status.textContent = 'Reading a finalized block and comparing both Ethereum endpoints…';
  results.hidden = true;
  try {
    const response = await fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: value || null }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The read failed. Please try again.');
    render(data);
    status.textContent = 'Live read complete. Values reflect the finalized block shown below.';
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : 'The local connection is unavailable. Please try again.';
    status.className = 'error';
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', refresh);
void refresh();
