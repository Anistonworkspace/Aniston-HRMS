# Browser Test Patterns (Chrome MCP)

## Get Auth Token
```javascript
window.localStorage.getItem('accessToken')
```

## Make API Call from Browser
```javascript
const token = window.localStorage.getItem('accessToken');
const xhr = new XMLHttpRequest();
xhr.open('GET', 'http://localhost:4000/api/endpoint', false);
xhr.setRequestHeader('Authorization', 'Bearer ' + token);
xhr.send();
JSON.parse(xhr.responseText)
```

## Check Page Loaded
```javascript
!document.body.innerText.includes('Restoring session')
```

## Check for UI Issues
```javascript
({
  hasUndefined: document.body.innerText.includes('undefined'),
  hasNaN: document.body.innerText.includes('NaN'),
  isLoading: document.body.innerText.includes('Restoring session'),
  hasContent: document.body.innerText.length > 200,
  hasHorizontalScroll: document.body.scrollWidth > window.innerWidth
})
```

## Trigger React Input Change
```javascript
const input = document.querySelector('input[name="field"]');
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
nativeInputValueSetter.call(input, 'new value');
input.dispatchEvent(new Event('input', { bubbles: true }));
```
