import{Component}from '@theme/component';import{QuantitySelectorUpdateEvent}from '@theme/events';import{parseIntOrDefault}from '@theme/utilities';export class QuantitySelectorComponent extends Component{requiredRefs=['quantityInput','minusButton','plusButton'];serverDisabledMinus=!1;serverDisabledPlus=!1;initialized=!1;connectedCallback(){super.connectedCallback();const{minusButton,plusButton}=this.refs;if(minusButton.disabled){this.serverDisabledMinus=!0}
if(plusButton.disabled){this.serverDisabledPlus=!0}
this.initialized=!0;this.updateButtonStates()}
disconnectedCallback(){super.disconnectedCallback()}
setCartQuantity(cartQty){this.refs.quantityInput.setAttribute('data-cart-quantity',cartQty.toString());this.updateCartQuantity()}
canAddToCart(){const{max,cartQuantity,value}=this.getCurrentValues();const quantityToAdd=value;const wouldExceedMax=max!==null&&cartQuantity+quantityToAdd>max;return{canAdd:!wouldExceedMax,maxQuantity:max,cartQuantity,quantityToAdd,}}
getValue(){return this.refs.quantityInput.value}
setValue(value){this.refs.quantityInput.value=value}
updateConstraints(min,max,step){const{quantityInput}=this.refs;const currentValue=parseInt(quantityInput.value)||0;quantityInput.min=min;if(max){quantityInput.max=max}else{quantityInput.removeAttribute('max')}
quantityInput.step=step;const newMin=parseIntOrDefault(min,1);const newStep=parseIntOrDefault(step,1);const effectiveMax=this.getEffectiveMax();let newValue=currentValue;if((currentValue-newMin)%newStep!==0){newValue=newMin+Math.floor((currentValue-newMin)/newStep)*newStep}
newValue=Math.max(newMin,Math.min(effectiveMax??Infinity,newValue));if(newValue!==currentValue){quantityInput.value=newValue.toString()}
this.updateButtonStates()}
getCurrentValues(){const{quantityInput}=this.refs;return{min:parseIntOrDefault(quantityInput.min,1),max:parseIntOrDefault(quantityInput.max,null),step:parseIntOrDefault(quantityInput.step,1),value:parseIntOrDefault(quantityInput.value,0),cartQuantity:parseIntOrDefault(quantityInput.getAttribute('data-cart-quantity'),0),}}
getEffectiveMax(){const{max,cartQuantity,min}=this.getCurrentValues();if(max===null)return null;return Math.max(max-cartQuantity,min)}
updateButtonStates(){const{minusButton,plusButton}=this.refs;const{min,value}=this.getCurrentValues();const effectiveMax=this.getEffectiveMax();if(!this.serverDisabledMinus){minusButton.disabled=value<=min}
if(!this.serverDisabledPlus){plusButton.disabled=effectiveMax!==null&&value>=effectiveMax}}
updateQuantity(stepMultiplier){const{quantityInput}=this.refs;const{min,step,value}=this.getCurrentValues();const effectiveMax=this.getEffectiveMax();const newValue=Math.min(effectiveMax??Infinity,Math.max(min,value+step*stepMultiplier));quantityInput.value=newValue.toString();this.onQuantityChange();this.updateButtonStates()}
increaseQuantity(event){if(!(event.target instanceof HTMLElement))return;event.preventDefault();this.updateQuantity(1)}
decreaseQuantity(event){if(!(event.target instanceof HTMLElement))return;event.preventDefault();this.updateQuantity(-1)}
selectInputValue(event){const{quantityInput}=this.refs;if(!(event.target instanceof HTMLInputElement)||document.activeElement!==quantityInput)return;quantityInput.select()}
setQuantity(event){if(!(event.target instanceof HTMLInputElement))return;event.preventDefault();const{quantityInput}=this.refs;const{min,step}=this.getCurrentValues();const effectiveMax=this.getEffectiveMax();const quantity=Math.min(effectiveMax??Infinity,Math.max(min,parseInt(event.target.value)||0));if((quantity-min)%step!==0){quantityInput.value=quantity.toString();quantityInput.reportValidity();return}
quantityInput.value=quantity.toString();this.onQuantityChange();this.updateButtonStates()}
onQuantityChange(){const{quantityInput}=this.refs;const newValue=parseInt(quantityInput.value);this.dispatchEvent(new QuantitySelectorUpdateEvent(newValue,Number(quantityInput.dataset.cartLine)||undefined))}
updateCartQuantity(){const{quantityInput}=this.refs;const{min,value}=this.getCurrentValues();const effectiveMax=this.getEffectiveMax();const clampedValue=Math.min(effectiveMax??Infinity,Math.max(min,value));if(clampedValue!==value){quantityInput.value=clampedValue.toString()}
this.updateButtonStates()}
get quantityInput(){if(!this.refs.quantityInput){throw new Error('Missing <input ref="quantityInput" /> inside <quantity-selector-component />')}
return this.refs.quantityInput}}
if(!customElements.get('quantity-selector-component')){customElements.define('quantity-selector-component',QuantitySelectorComponent)}