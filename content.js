// content.js

// --- Global State ---
let activeFormData = null;
let formFillAttempted = false;

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fillForm") {
        console.log("Content script received fillForm message:", request);
        activeFormData = request.identityData;
        formFillAttempted = false;
        
        // Try to fill immediately
        setTimeout(() => attemptFormFill(), 100);
        // Try again after a bit longer
        setTimeout(() => attemptFormFill(), 500);
        // Try once more
        setTimeout(() => attemptFormFill(), 1000);
        
        sendResponse({ status: "received" });
        return true;
    }
    if (request.action === "clickSignUpButton") {
        console.log("Content script received clickSignUpButton message");
        const clicked = attemptClickSignUp();
        sendResponse({ status: clicked ? "clicked" : "not_found" });
        return true;
    }
    return true;
});

// Get all form inputs on the page
function getAllFormInputs() {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="checkbox"]):not([type="radio"])'));
}

// Find label text associated with an input
function getLabelForInput(input) {
    // Try to find associated label
    if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) return label.textContent.toLowerCase();
    }
    
    // Check parent for label
    const parent = input.closest('.form-group, .field, [class*="field"], [class*="form"]');
    if (parent) {
        const label = parent.querySelector('label');
        if (label) return label.textContent.toLowerCase();
    }
    
    // Check previous siblings
    let prev = input.previousElementSibling;
    while (prev) {
        if (prev.tagName === 'LABEL') return prev.textContent.toLowerCase();
        prev = prev.previousElementSibling;
    }
    
    // Check placeholder as last resort
    if (input.placeholder) return input.placeholder.toLowerCase();
    
    return '';
}

// Match input field to our data based on visual context
function findInputForData(dataKey, dataValue) {
    const inputs = getAllFormInputs();
    
    const keywords = {
        firstName: ['first name', 'first-name', 'firstname', 'given name'],
        lastName: ['last name', 'last-name', 'lastname', 'family name', 'surname'],
        fullName: ['full name', 'full-name', 'name', 'your name'],
        email: ['email', 'email address', 'e-mail', 'mail', 'electronic mail'],
        phone: ['phone', 'phone number', 'telephone', 'mobile', 'cell phone', 'contact number'],
        username: ['username', 'user name', 'login', 'account name', 'user id'],
        password: ['password', 'pass', 'account password', 'create password', 'new password'],
        confirmPassword: ['confirm password', 'confirm pass', 'password confirm', 're-enter password', 'retype password'],
        ssn: ['ssn', 'social security', 'social-security', 'social security number'],
        dob: ['date of birth', 'birth date', 'dob', 'birthday', 'born'],
        gender: ['gender', 'sex', 'male/female'],
        streetAddress: ['street address', 'street', 'address line 1', 'address1', 'street line'],
        aptSuite: ['apt', 'apartment', 'suite', 'unit', 'address line 2', 'address2'],
        city: ['city', 'town', 'city name'],
        state: ['state', 'province', 'state/province'],
        zip: ['zip', 'zip code', 'postal code', 'postal', 'zipcode']
    };
    
    const searchTerms = keywords[dataKey] || [];
    let bestMatch = null;
    let bestScore = 0;

    for (const input of inputs) {
        const labelText = getLabelForInput(input);
        const placeholder = (input.placeholder || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        
        // Combine all text
        const fullText = `${labelText} ${placeholder} ${name} ${id}`;
        
        // Check each search term
        for (const term of searchTerms) {
            const termLower = term.toLowerCase();
            if (fullText.includes(termLower)) {
                // Calculate score based on match quality
                let score = 0;
                if (labelText.includes(termLower)) score += 10;
                if (name.includes(termLower)) score += 8;
                if (id.includes(termLower)) score += 7;
                if (placeholder.includes(termLower)) score += 5;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = input;
                }
            }
        }
    }
    
    return bestMatch;
}

// Set value on input with proper React handling
function setInputValue(input, value) {
    if (!input) return false;

    try {
        // Check if visible
        const style = window.getComputedStyle(input);
        if (style.display === 'none' || style.visibility === 'hidden' || input.disabled) {
            console.warn("Input is hidden or disabled");
            return false;
        }

        // Check dimensions
        const rect = input.getBoundingClientRect();
        if (rect.height === 0 && rect.width === 0) {
            console.warn("Input has zero dimensions");
            return false;
        }

        // Focus the input first
        input.focus();

        // Clear existing value
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Set new value
        input.value = value;

        // Trigger React's value setter if it exists
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, value);

        // Trigger all events
        const events = [
            new Event('input', { bubbles: true, cancelable: true }),
            new Event('change', { bubbles: true, cancelable: true }),
            new Event('blur', { bubbles: true, cancelable: true }),
            new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true }),
            new KeyboardEvent('keyup', { key: 'End', code: 'End', bubbles: true })
        ];

        events.forEach(event => {
            try {
                input.dispatchEvent(event);
            } catch (e) {
                // Silent
            }
        });

        // Trigger parent form event
        const form = input.closest('form');
        if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }

        console.log(`✓ Set ${input.id || input.name || 'unknown'} to "${value}"`);
        return true;

    } catch (e) {
        console.error("Error setting input value:", e);
        return false;
    }
}

// Main form fill function
function attemptFormFill() {
    if (!activeFormData) {
        return;
    }

    console.log("=== Starting Form Fill ===");
    console.log("Data to fill:", activeFormData);
    
    let filledCount = 0;
    const results = {
        filled: [],
        failed: [],
        notFound: []
    };

    // Define fields in order
    const fieldsToFill = [
        { key: 'firstName', value: activeFormData.firstName },
        { key: 'lastName', value: activeFormData.lastName },
        { key: 'email', value: activeFormData.email },
        { key: 'username', value: activeFormData.username },
        { key: 'password', value: activeFormData.password },
        { key: 'confirmPassword', value: activeFormData.confirmPassword },
        { key: 'phone', value: activeFormData.phone },
        { key: 'ssn', value: activeFormData.ssn },
        { key: 'dob', value: activeFormData.dob },
        { key: 'gender', value: activeFormData.gender },
        { key: 'streetAddress', value: activeFormData.streetAddress },
        { key: 'aptSuite', value: activeFormData.aptSuite },
        { key: 'city', value: activeFormData.city },
        { key: 'state', value: activeFormData.state },
        { key: 'zip', value: activeFormData.zip }
    ];

    for (const field of fieldsToFill) {
        if (!field.value || field.value.trim() === '') {
            console.log(`⊘ Skipping ${field.key} (no data)`);
            continue;
        }

        const input = findInputForData(field.key, field.value);

        if (!input) {
            console.warn(`✗ No field found for ${field.key}`);
            results.notFound.push(field.key);
            continue;
        }

        const label = getLabelForInput(input);
        console.log(`→ Found ${field.key} field with label: "${label}"`);

        if (setInputValue(input, field.value)) {
            results.filled.push(field.key);
            filledCount++;
        } else {
            results.failed.push(field.key);
        }
    }

    formFillAttempted = true;
    console.log(`=== Fill Complete: ${filledCount} filled ===`);

    try {
        chrome.runtime.sendMessage({ 
            status: "filled", 
            count: filledCount,
            results: results
        }).catch(() => {});
    } catch (e) {
        console.error("Error sending message:", e);
    }
}

// Attempt to click signup button
function attemptClickSignUp() {
    const signupKeywords = ['create account', 'signup', 'sign up', 'register', 'join', 'submit', 'create'];
    
    const buttons = document.querySelectorAll('button, a[role="button"], input[type="submit"]');

    for (const button of buttons) {
        const text = button.textContent?.trim().toLowerCase() || '';
        const value = button.value?.trim().toLowerCase() || '';
        const aria = button.getAttribute('aria-label')?.trim().toLowerCase() || '';

        for (const keyword of signupKeywords) {
            if (text.includes(keyword) || value.includes(keyword) || aria.includes(keyword)) {
                if (text.includes('cancel') || text.includes('back')) continue;

                try {
                    const style = window.getComputedStyle(button);
                    if (style.display !== 'none' && style.visibility !== 'hidden') {
                        console.log("Clicking button:", text || value);
                        button.click();
                        return true;
                    }
                } catch (e) {
                    // Silent
                }
            }
        }
    }
    
    return false;
}

// Auto-fill on page load
window.addEventListener('load', () => {
    if (activeFormData && !formFillAttempted) {
        setTimeout(() => attemptFormFill(), 300);
    }
});

// Auto-fill on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    if (activeFormData && !formFillAttempted) {
        setTimeout(() => attemptFormFill(), 300);
    }
});

// Watch for DOM mutations (React sites)
let mutationTimeout;
const observer = new MutationObserver(() => {
    if (activeFormData && !formFillAttempted) {
        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(() => {
            console.log("DOM mutation detected, retrying fill");
            attemptFormFill();
        }, 500);
    }
});

try {
    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
} catch (e) {
    console.error("Observer error:", e);
}

// Fallback
setTimeout(() => {
    if (activeFormData && !formFillAttempted) {
        console.log("Running fallback fill");
        attemptFormFill();
    }
}, 2500);
