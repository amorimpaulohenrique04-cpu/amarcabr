import{morph}from '@theme/morph';class SectionRenderer{#cache=new Map();#abortControllersBySectionId=new Map();#pendingPromises=new Map();constructor(){window.addEventListener('load',this.#cachePageSections.bind(this))}
async renderSection(sectionId,options){const{cache=!Shopify.designMode}=options??{};const{url}=options??{};this.#abortPendingMorph(sectionId);const abortController=new AbortController();this.#abortControllersBySectionId.set(sectionId,abortController);const sectionHTML=await this.getSectionHTML(sectionId,cache,url);if(!abortController.signal.aborted){this.#abortControllersBySectionId.delete(sectionId);morphSection(sectionId,sectionHTML)}
return sectionHTML}
#abortPendingMorph(sectionId){const existingAbortController=this.#abortControllersBySectionId.get(sectionId);if(existingAbortController){existingAbortController.abort()}}
async getSectionHTML(sectionId,useCache=!0,url=new URL(window.location.href)){const sectionUrl=buildSectionRenderingURL(sectionId,url);let pendingPromise=this.#pendingPromises.get(sectionUrl);if(pendingPromise)return pendingPromise;if(useCache){const cachedHTML=this.#cache.get(sectionUrl);if(cachedHTML)return cachedHTML}
pendingPromise=fetch(sectionUrl).then((response)=>{return response.text()});this.#pendingPromises.set(sectionUrl,pendingPromise);const sectionHTML=await pendingPromise;this.#pendingPromises.delete(sectionUrl);this.#cache.set(sectionUrl,sectionHTML);return sectionHTML}
#cachePageSections(){for(const section of document.querySelectorAll('.shopify-section')){const url=buildSectionRenderingURL(section.id);if(this.#cache.get(url))return;if(containsShadowRoot(section))return;this.#cache.set(url,section.outerHTML)}}}
const SECTION_ID_PREFIX='shopify-section-';function buildSectionRenderingURL(sectionId,url=new URL(window.location.href)){url.searchParams.set('section_id',normalizeSectionId(sectionId));url.searchParams.sort();return url.toString()}
export function buildSectionSelector(sectionId){return `${SECTION_ID_PREFIX}${sectionId}`}
export function normalizeSectionId(sectionId){return sectionId.replace(new RegExp(`^${SECTION_ID_PREFIX}`),'')}
function containsShadowRoot(element){return!!element.shadowRoot||Array.from(element.children).some(containsShadowRoot)}
export async function morphSection(sectionId,html){const fragment=new DOMParser().parseFromString(html,'text/html');const existingElement=document.getElementById(buildSectionSelector(sectionId));const newElement=fragment.getElementById(buildSectionSelector(sectionId));if(!existingElement){throw new Error(`Section ${sectionId} not found`)}
if(!newElement){throw new Error(`Section ${sectionId} not found in the section rendering response`)}
morph(existingElement,newElement)}
export const sectionRenderer=new SectionRenderer()