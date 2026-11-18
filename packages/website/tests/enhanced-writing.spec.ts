import { expect, test, type Page } from '@playwright/test';
import { fixture, note } from './fixtures/workspace-fixture';
import type { ProofingConsent, ProofingCheck } from '@lib/shared/proofing-contract';

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const editorUrl = `${base}/app/memories/${note.id}?mode=edit`;
const text = 'Keep this other paragraph private.\n\nReview [**teh** notebook](https://private.example/marker) and `private-code` today.';
const editor = (page: Page) => page.getByRole('textbox', {name:'What should stay with you?'});
const check = (page: Page) => page.getByRole('button', {name:'Check paragraph'});

async function workspace(page: Page, initial: ProofingConsent) {
  let consent = initial;
  const writes: ProofingConsent[] = [];
  await fixture(page, [{...note, content:text}]);
  await page.route('**/api/grove/proofing/consent', async route => {
    if(route.request().method() === 'PUT') { consent = route.request().postDataJSON(); writes.push(consent); }
    await route.fulfill({json:consent});
  });
  return writes;
}

test('Enhanced consent starts off; automatic checks are a separate account choice', async ({page}, info) => {
  await page.setViewportSize({width:390,height:844});
  const writes = await workspace(page, {enabled:false, automatic:false});
  await page.goto(`${base}/app/settings`);
  const grant = page.getByRole('checkbox', {name:'Enhanced grammar', exact:true});
  const auto = page.getByRole('checkbox', {name:'Automatically check edited paragraphs'});
  await expect(grant).toBeEnabled(); await expect(grant).not.toBeChecked(); await expect(auto).toHaveCount(0);
  await grant.check(); await expect(auto).not.toBeChecked(); await auto.check(); await expect(auto).toBeChecked();
  await grant.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('enhanced-settings-390.png')});
  await grant.uncheck(); await expect(auto).toHaveCount(0);
  expect(writes).toEqual([{enabled:true,automatic:false},{enabled:true,automatic:true},{enabled:false,automatic:false}]);
});

test('formatted link labels merge local and paragraph fixes; apply and undo preserve Markdown', async ({page}, info) => {
  await page.setViewportSize({width:1440,height:900});
  await workspace(page, {enabled:true,automatic:false});
  const requests:ProofingCheck[]=[];
  await page.route('**/api/grove/proofing/check', async route => {
    const body:ProofingCheck = route.request().postDataJSON(); requests.push(body);
    expect(route.request().headers()['x-grove-proofing-mode']).toBe('manual');
    const from = body.text.indexOf('teh');
    const issue = {id:'fixture',rule:'spelling',message:'spelling',from,to:from+3,original:'teh',replacements:['the','test']};
    // A masked range with matching blanks must still never be editable.
    const hidden=body.text.indexOf('   ', body.text.indexOf('notebook')+8);
    await route.fulfill({json:{revision:body.revision,complete:true,issues:[issue,{...issue,id:'hidden',from:hidden,to:hidden+3,original:'   ',replacements:['unsafe']}]}});
  });
  await page.goto(editorUrl);
  const typo=editor(page).locator('.grove-writing-spelling').filter({hasText:/^teh$/});
  await expect(typo).toHaveCount(1,{timeout:15000}); expect(requests).toHaveLength(0);
  await editor(page).press('Control+End'); await check(page).click();
  await expect(page.getByText('Paragraph checked.',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(1); const body=requests[0]!;
  expect(Object.keys(body).sort()).toEqual(['revision','rules','text']);
  expect(body.text).toContain('teh'); expect(body.text).not.toMatch(/private|marker|https|\*|`|Keep this/);
  await expect(typo).toHaveCount(1); await typo.click();
  const card=page.getByRole('dialog',{name:/Writing suggestion/});
  await expect(card.getByRole('button',{name:'test',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('enhanced-editor-1440.png')});
  await card.getByRole('button',{name:'the',exact:true}).click(); await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toContainText('the'); await editor(page).press('Control+z');
  await expect(typo).toHaveCount(1); await editor(page).press('Control+Shift+z'); await expect(typo).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test('an automatic response that outlives an edit or revoked session cannot paint', async ({page}) => {
  await workspace(page,{enabled:true,automatic:true});
  // Exercise the stale-response fence even when an intermediary ignores abort.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch=(url,init)=>original(url,String(url).endsWith('/proofing/check') ? {...init,signal:undefined} : init);
  });
  const first=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();
  const bodies:ProofingCheck[]=[];
  await page.route('**/api/grove/proofing/check',async route=>{
    const body:ProofingCheck=route.request().postDataJSON(); bodies.push(body);
    expect(route.request().headers()['x-grove-proofing-mode']).toBe('automatic');
    if(bodies.length===1){ first.resolve(); await release.promise; }
    else { await route.fulfill({status:403,json:{success:false}}); return; }
    const from=body.text.indexOf('today');
    await route.fulfill({json:{revision:body.revision,complete:true,issues:[{id:'late',rule:'confusion',message:'confusion',from,to:from+5,original:'today',replacements:['tomorrow']}]}});
  });
  await page.goto(editorUrl); await expect(check(page)).toBeVisible(); expect(bodies).toHaveLength(0);
  await editor(page).press('Control+End'); await page.keyboard.insertText(' First.'); await first.promise;
  await page.keyboard.insertText(' Second.'); release.resolve();
  await expect(check(page)).toHaveCount(0); await expect(editor(page)).toContainText('Second.');
  await expect(editor(page).locator('.grove-writing-grammar').filter({hasText:'today'})).toHaveCount(0);
  await page.keyboard.insertText(' Third.'); await expect(editor(page).locator('.grove-writing-spelling').first()).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies.map(b=>b.text).join(' ')).not.toMatch(/private|marker|https/);
});

test('no paragraph leaves when the credential is unavailable or the account switches during token acquisition',async({page})=>{
  await workspace(page,{enabled:true,automatic:true});
  const transfers:string[]=[]; page.on('request',r=>{if(r.url().endsWith('/proofing/check')) transfers.push(r.url());});
  await page.goto(editorUrl); await expect(check(page)).toBeVisible();
  await page.evaluate(()=>Object.assign(window,{getWorkspaceToken:async()=>null}));
  await check(page).click(); await expect(page.getByText(/Enhanced check unavailable/)).toBeVisible();
  await page.evaluate(()=>Object.assign(window,{getWorkspaceToken:async()=>{
    (window as unknown as {switchWorkspaceAccount:(u:string,s:string)=>void}).switchWorkspaceAccount('',''); return 'old-token';
  }}));
  await check(page).click(); await expect(page.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  expect(transfers).toEqual([]);
});
