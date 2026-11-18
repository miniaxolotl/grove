import {packWeirpackFiles} from 'harper.js';
import type {WritingIssue} from './writing-settings.ts';

// Small language-pack supplements evaluated by Harper's parser and suggestion
// engine. Filters keep the editable span separate from its grammatical context.
type Entry=[family:WritingIssue['rule'],expression:string,to:string,exact?:boolean];
const rules:Record<string,Entry>={
  GroveObjectPronoun:['confusion','<([(between you), (from my [mother, father, brother, sister])] and I), I>','me',true],
  GroveWeather:['confusion','<((weather or not) [I, you, he, she, it, we, they]), weather>','whether'],
  GroveByAndLarge:['confusion','<(by in large,), in>','and'],
  GroveComparison:['confusion','<([bigger, smaller, better, worse, faster, slower, longer, shorter] then [this, that, me, you, him, her, us, them]), then>','than'],
  GroveRegularly:['redundancy','(on a regular basis)','regularly'],
  GroveIndefiniteA:['articles','<(an [ewe, ubiquitous, unanimous, NASA, (N.A.S.A.)]), an>','a'],
  GroveIndefiniteAn:['articles','<(a [onerous, unidentified, honourable]), a>','an'],
  GroveTheyHave:['confusion','<(their been), their>',"they've"],
  GroveYouHave:['confusion','<(your been), your>',"you've"],
  GroveThirdPerson:['agreement',"<([he, she, it] don't), don't>","doesn't"],
  GrovePluralPerson:['agreement',"<([they, we, you, I] doesn't), doesn't>","don't"],
  GroveTaken:['agreement',"<([hasn't, haven't, hadn't] took), took>",'taken'],
  GroveFilmographies:['spelling','filmographys','filmographies'],
};
export const profileFamilies=new Map(Object.entries(rules).map(([id,[family]])=>[id,family]));

export function profilePack(){
  const files=new Map([['manifest.json',JSON.stringify({author:'Grove',license:'MIT',version:'1.0.0',description:'Conservative English note-writing profile'})]]);
  for(const [id,[family,expr,to,exact]] of Object.entries(rules)) files.set(`${id}.weir`, `expr main ${expr}\nlet message "Check this ${family}."\nlet description "Grove ${family} supplement."\nlet kind "Grammar"\nlet becomes ${JSON.stringify(to)}\nlet strategy "${exact?'Exact':'MatchCase'}"`);
  return packWeirpackFiles(files);
}

/** Contexts in which Harper 3.2.0 flags grammatical prose. Reject rather
 * than guessing whether the author meant a subjunctive, referent or idiom. */
export function abstain(name:string,original:string,before:string,after:string) {
  if(name==='AnA') {
    if(/^\s+(?:sql(?:ite)?|s\.q\.l|faq|url|xyz|herb|h[-‐‑]|html|historic|homage|unioni[sz]ed)/i.test(after)) return true;
    if(/^\s+(?:uni(?:vers|form|fy|on|t)|unanim|use|usual|one\b|ubiquit|ewe|n\.a\.s\.a)/i.test(after) && original.toLowerCase()==='a') return true;
    if(/^\s+(?:onerous|unidentified|honourable)/i.test(after)&&original.toLowerCase()==='an') return true;
  }
  if(name==='PronounVerbAgreement'&&/\b(?:suggest|insist|require|recommend|let|make)\b[^.!?;]*$/i.test(before)) return true;
  if(name==='MoreBetter'||name==='AdjectiveDoubleDegree') return !/\b(?:is|are|was|were|be)(?: the)?\s+$/i.test(before);
  if(name==='ThenThan'&&/\bif\b[^.!?;]*$/i.test(before)) return true;
  if(name==='ModalOf'&&/^\s+(?:necessity|course)\b/i.test(after)) return true;
  if(name==='SimplePastToPastParticiple'&&(/^(?:saw|rose)$/i.test(original)||/^\s+(?:missing|bankrupt)\b/i.test(after))) return true;
  return name==='SupposedTo'&&/^\s+some extent\b/i.test(after);
}
