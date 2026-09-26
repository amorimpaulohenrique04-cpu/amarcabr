import{Component}from '@theme/component';class ProductTitle extends Component{constructor(){super()}
connectedCallback(){super.connectedCallback();this.#initializeTruncation()}
#initializeTruncation(){if('ResizeObserver' in window){this.resizeObserver=new ResizeObserver(()=>{this.#calculateTruncation()});this.resizeObserver.observe(this);this.#calculateTruncation()}else{(window).addEventListener('resize',this.#handleResize.bind(this));this.#calculateTruncation()}}
#calculateTruncation(){const textElement=this.refs.text||this.querySelector('.title-text')||this;if(!textElement.textContent)return;const containerHeight=this.clientHeight;const computedStyle=window.getComputedStyle(this);const lineHeight=parseFloat(computedStyle.lineHeight);const paddingTop=parseFloat(computedStyle.paddingTop);const paddingBottom=parseFloat(computedStyle.paddingBottom);const availableHeight=containerHeight-paddingTop-paddingBottom;const maxLines=Math.max(1,Math.floor(availableHeight/lineHeight));textElement.style.display='-webkit-box';textElement.style.webkitBoxOrient='vertical';textElement.style.overflow='hidden';textElement.style.textOverflow='ellipsis';textElement.style.webkitLineClamp=String(maxLines)}
#handleResize(){this.#calculateTruncation()}
disconnectedCallback(){super.disconnectedCallback();if(this.resizeObserver){this.resizeObserver.disconnect()}
window.removeEventListener('resize',this.#handleResize)}}
if(!customElements.get('product-title')){customElements.define('product-title',ProductTitle)}
export default ProductTitle