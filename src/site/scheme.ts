/**
 * The one script a public page may carry (ADR 0074 d4): it turns the site
 * between its light and dark colours when the visitor asks, and remembers that
 * in the visitor's own browser. It is linked in the head, so the choice is on
 * the page before it is painted; it reads and writes nothing else.
 */
export const SCHEME_SCRIPT_PATH = '/assets/scheme.js';

export const SCHEME_SCRIPT = `(()=>{const r=document.documentElement,k="uhlaka-scheme",m=matchMedia("(prefers-color-scheme: dark)");let s=null;try{s=localStorage.getItem(k)}catch{}if(s==="light"||s==="dark")r.dataset.scheme=s;const dark=()=>r.dataset.scheme?r.dataset.scheme==="dark":m.matches;addEventListener("DOMContentLoaded",()=>{for(const b of document.querySelectorAll(".scheme-switch")){b.hidden=false;b.addEventListener("click",()=>{const next=dark()?"light":"dark";try{if(next===(m.matches?"dark":"light")){delete r.dataset.scheme;localStorage.removeItem(k)}else{r.dataset.scheme=next;localStorage.setItem(k,next)}}catch{r.dataset.scheme=next}})}})})();
`;
