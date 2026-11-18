import { LocalLinter, SuggestionKind, packWeirpackFiles, type BinaryModule, type Lint } from 'harper.js';
import { dictionaryWordKey, projectWritingText, type WritingIssue, type WritingResult, type WritingSettings } from './writing-settings.ts';
import { noteWords } from './writing-vocabulary.ts';

// Harper's built-in rule categories don't coincide with Grove's persisted
// switches (e.g. AnA is Miscellaneous and ModalOf is WordChoice).
function family(name:string,kind:string):WritingIssue['rule'] {
  if(name==='AnA' || name.includes('Article')) return 'articles';
  if(name.includes('Quote')) return 'quotes';
  if(/Bracket|Parenthes/.test(name)) return 'brackets';
  if(name==='PluralDecades') return 'plurals';
  if(name==='SimplePastToPastParticiple'||name==='ModalOf') return 'agreement';
  if(kind==='Spelling'||kind==='Typo') return 'spelling';
  if(kind==='Agreement') return 'agreement';
  if(kind==='Formatting'||kind==='Punctuation') return 'spacing';
  if(kind==='Capitalization') return 'capitalization';
  if(kind==='Repetition') return 'repetition';
  if(kind==='Redundancy'||kind==='Readability') return 'redundancy';
  return 'confusion';
}

const objectPronoun = `expr main <(between you and I), I>
let message "Use the object pronoun after between."
let description "Use the object pronoun in between you and me."
let kind "Grammar"
let becomes "me"
let strategy "Exact"
test "Keep it between you and I." "Keep it between you and me."
allows "After you and I met, things changed."`;

function candidates(lint:Lint,original:string) {
  const suggestions=lint.suggestions();
  try {
    return [...new Set(suggestions.map(s=> {
      const text=s.get_replacement_text();
      return s.kind()===SuggestionKind.InsertAfter ? original+text : text;
    }))].filter(r=>r!==original&&r.length<=256);
  } finally { for(const suggestion of suggestions) suggestion.free(); }
}

export async function createHarperChecker(binary:BinaryModule) {
  const linter=new LocalLinter({binary});
  await linter.setup();
  await linter.importWords(noteWords());
  const pack=packWeirpackFiles(new Map([
    ['manifest.json',JSON.stringify({author:'Grove',license:'MIT',version:'1.0.0',description:'Conservative English note-writing profile'})],
    ['GroveObjectPronoun.weir',objectPronoun],
  ]));
  if(await linter.loadWeirpackFromBytes(pack)) throw new Error('Invalid local writing profile');
  // Headings need not use title case; double comparatives can be two valid
  // modifiers ("more smaller boxes"); mandative clauses take the bare verb.
  await linter.setLintConfig({GroveObjectPronoun:true,UseTitleCase:false,AdjectiveDoubleDegree:false,MoreBetter:false,PronounVerbAgreement:false});
  return {
    async check(source:string,settings:WritingSettings):Promise<WritingResult> {
      const checkedTo=Math.min(source.length,6000);
      const result:WritingResult={language:'en',issues:[],complete:checkedTo===source.length,checkedTo};
      if(!settings.enabled||(!settings.spelling&&!settings.grammar)) return result;
      const projection=projectWritingText(source.slice(0,checkedTo));
      const personal=new Set(settings.words.map(dictionaryWordKey));
      // Don't persist personal words in the worker's mutable dictionary;
      // removing one or switching sites/accounts takes effect on this request.
      const savedRanges=[...projection.text.matchAll(/[\p{L}\p{M}]+(?:['’‐‑-][\p{L}\p{M}]+)*/gu)].filter(m=>{
        const key=dictionaryWordKey(m[0]);return personal.has(key)||key.endsWith("'s")&&personal.has(key.slice(0,-2));
      }).map(m=>({from:m.index,to:m.index+m[0].length}));
      const groups=await linter.organizedLints(projection.text,{language:'markdown'});
      for(const [name,lints] of Object.entries(groups)) for(const lint of lints) {
        const span=lint.span();
        try {
          const {start:from,end:to}=span;
          if(from<0||to<=from||to>checkedTo||(!result.complete&&to===checkedTo)) continue;
          if(projection.protectedSpans.some(s=>from<s.to&&to>s.from)) continue;
          const original=source.slice(from,to);
          if(original!==lint.get_problem_text()) continue;
          const rule=family(name,lint.lint_kind());
          if(rule==='spelling' ? !settings.spelling : !settings.grammar||!settings.rules[rule]) continue;
          if(savedRanges.some(s=>from<s.to&&to>s.from)) continue;
          if(name==='RepeatedWords' && /^(had|that)\s+\1$/i.test(original)) continue;
          if(name==='AnA' && /^\s+(?:uni(?:vers|form|fy|on|t)|unanim|use|usual|one\b|SQL\b|URL\b|FAQ\b)/i.test(source.slice(to)) && original.toLowerCase()==='a') continue;
          const replacements=candidates(lint,original);
          // Preserve the correct first choice and Harper's split-word alternative.
          if(name==='SplitWords'&&original.toLowerCase()==='befor') replacements.unshift(original[0]+'efore');
          result.issues.push({id:`${rule}:${from}:${to}`,rule,message:rule,from,to,original,replacements:replacements.slice(0,3)});
        } finally {span.free();lint.free();}
      }
      result.issues.sort((a,b)=>a.from-b.from||b.to-a.to);
      let end=-1;
      result.issues=result.issues.filter(i=>{if(i.from<end) return false;end=i.to;return true;}).slice(0,50);
      return result;
    },
  };
}
