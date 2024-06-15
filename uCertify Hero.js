// ==UserScript==
// @name         uCertify Hero
// @name:zh-CN   uCertify Hero
// @name:zh-TW   uCertify Hero
// @namespace    http://tampermonkey.net/
// @version      1.91
// @description  Automates answering questions on uCertify using online searches and ChatGPT 4o
// @description:zh-CN 自动通过在线搜索和ChatGPT 4o回答uCertify上的问题
// @description:zh-TW 自動通過線上搜尋和ChatGPT 4o回答uCertify上的問題
// @author       TFG
// @match        https://www.ucertify.com/app/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // Debounce function to limit the rate at which the main function is called
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Function to create a small loading spinner element
    function createSmallSpinner() {
        const spinner = document.createElement('div');
        spinner.className = 'quiz-helper-small-spinner';
        spinner.style.border = '4px solid #f3f3f3';
        spinner.style.borderTop = '4px solid #3498db';
        spinner.style.borderRadius = '50%';
        spinner.style.width = '24px';
        spinner.style.height = '24px';
        spinner.style.animation = 'spin 1s linear infinite';

        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.getElementsByTagName('head')[0].appendChild(style);

        return spinner;
    }

    // Function to show the spinner inside the answer area
    function showSmallSpinner() {
        let answerElement = document.querySelector('.quiz-helper-answer');
        if (!answerElement) {
            answerElement = document.createElement('div');
            answerElement.className = 'quiz-helper-answer';
            const questionElement = document.querySelector('.test-question ._title') || document.querySelector('.test-question [data-itemtype="question"]');
            if (questionElement) {
                questionElement.appendChild(answerElement);
            }
        }
        const spinner = createSmallSpinner();
        answerElement.innerHTML = ''; // Clear any previous content
        answerElement.appendChild(spinner);
    }

    // Function to hide the spinner
    function hideSmallSpinner() {
        const spinner = document.querySelector('.quiz-helper-small-spinner');
        if (spinner) {
            spinner.remove();
        }
    }


    // Function to get the quiz title from the webpage
    function getQuizTitle() {
        const titleElement = document.querySelector('a.nav-link.text-body.text-truncate');
        return titleElement ? titleElement.innerText.trim() : 'Quiz';
    }

    // Function to get the question and options from the webpage
    function getQuestionAndOptions() {
        const questionElement = document.querySelector('.test-question ._title') || document.querySelector('.test-question [data-itemtype="question"]');
        const question = questionElement ? questionElement.innerText.trim() : '';
        console.log('Question:', question); // Debug output

        let options = [];
        const optionElementsLeft = document.querySelectorAll('.shuffleList1 .matchlist_list');
        const optionElementsRight = document.querySelectorAll('.shuffleList2 .matchlist_list');

        if (optionElementsLeft.length > 0 && optionElementsRight.length > 0) {
            options = {
                left: Array.from(optionElementsLeft).map(option => option.innerText.trim()),
                right: Array.from(optionElementsRight).map(option => option.innerText.trim())
            };
            console.log('Matching options:', options); // Debug output
        } else {
            const optionsElements = document.querySelectorAll('#item_answer .radio_label, #item_answer .chekcbox_label');
            options = Array.from(optionsElements).map(option => option.innerText.trim().replace(/^\w\./, '').trim());
            console.log('Multiple choice options:', options); // Debug output
        }

        return { question, options };
    }

    // Function to perform DuckDuckGo search using GM_xmlhttpRequest
    async function duckDuckGoSearch(query) {
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status === 200) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');

                        const results = Array.from(doc.querySelectorAll('.result')).slice(0, 5).map(result => ({
                            title: result.querySelector('.result__a')?.innerText,
                            snippet: result.querySelector('.result__snippet')?.innerText,
                            link: result.querySelector('.result__a')?.href
                        }));

                        resolve(results);
                    } else {
                        reject('Error fetching search results');
                    }
                },
                onerror: function() {
                    reject('Network error');
                }
            });
        });
    }

    // Function to get search suggestions from GPT
    async function getSearchSuggestions(title, question, options) {
        const apiKey = localStorage.getItem('openai_api_key');
        if (!apiKey) {
            alert('API Key not set. Please go to the settings menu to configure your API Key.');
            return 'API Key not set';
        }

        let prompt;
        if (options.left && options.right) {
            prompt = `Quiz Title: ${title}\nQuestion: ${question}\nMatch the following terms to their definitions:\nTerms:\n${options.left.join('\n')}\nDefinitions:\n${options.right.join('\n')}\nPlease provide only the search keywords.`;
        } else if (options.length > 0) {
            prompt = `Quiz Title: ${title}\nQuestion: ${question}\nOptions:\n${options.map((opt, index) => String.fromCharCode(65 + index) + '. ' + opt).join('\n')}\nPlease provide only the search keywords.`;
        }

        console.log('Prompt for search suggestions:', prompt);

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": prompt}
                    ]
                })
            });
            const data = await response.json();
            console.log('Search suggestions API Response:', data);

            if (data.choices && data.choices.length > 0) {
                return data.choices[0].message.content.trim();
            } else {
                console.error('No search suggestions found in API response');
                return 'No search suggestions found';
            }
        } catch (error) {
            console.error('Error fetching search suggestions:', error);
            return 'Error fetching search suggestions';
        }
    }

    // Function to get answer from GPT with search results
    async function getChatGPTAnswerWithSearchResults(title, question, options, searchResults) {
        const apiKey = localStorage.getItem('openai_api_key');
        if (!apiKey) {
            alert('API Key not set. Please go to the settings menu to configure your API Key.');
            return 'API Key not set';
        }

        let prompt;
        if (options.left && options.right) {
            prompt = `Quiz Title: ${title}\nQuestion: ${question}\nMatch the following terms to their definitions:\nTerms:\n${options.left.join('\n')}\nDefinitions:\n${options.right.join('\n')}\nSearch Results:\n${searchResults.map(result => `${result.title}\n${result.snippet}`).join('\n\n')}\nPlease provide only the correct matches in the format "1-A\\n2-B\\n3-C". Do not include any additional text.`;
        } else if (options.length > 0) {
            prompt = `Quiz Title: ${title}\nQuestion: ${question}\nOptions:\n${options.map((opt, index) => String.fromCharCode(65 + index) + '. ' + opt).join('\n')}\nSearch Results:\n${searchResults.map(result => `${result.title}\n${result.snippet}`).join('\n\n')}\nPlease provide only the letter(s) of the correct answer(s) (e.g., A, B, C, or D) without any explanation.`;
        }

        console.log('Prompt for final answer:', prompt);

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens:1000
                })
            });
            const data = await response.json();
            console.log('Final answer API Response:', data);

            if (data.choices && data.choices.length > 0) {
                return data.choices[0].message.content.trim();
            } else {
                console.error('No choices found in API response');
                return 'No answer found';
            }
        } catch (error) {
            console.error('Error fetching final answer:', error);
            return 'Error fetching final answer';
        }
    }

    // Function to display the answer on the webpage
    function displayAnswer(answer) {
        // Check if the answer is already displayed
        const answerElement = document.querySelector('.quiz-helper-answer');

        if (!answerElement) {
            const newAnswerElement = document.createElement('div');
        }
        const newAnswerElement = document.createElement('div');
        newAnswerElement.className = 'quiz-helper-answer';
        newAnswerElement.innerHTML = answer;
        newAnswerElement.style.color = 'red';
        newAnswerElement.style.fontWeight = 'bold';

        const questionElement = document.querySelector('.test-question ._title') || document.querySelector('.test-question [data-itemtype="question"]');
        if (questionElement) {
            questionElement.appendChild(newAnswerElement);
        }

        // Hide the spinner once the answer is displayed
        hideSmallSpinner();
    }

    // Main function to get question and options, and then display the answer
    async function main() {
        // Check if the answer is already displayed before fetching it
        if (!document.querySelector('.quiz-helper-answer')) {

            const title = getQuizTitle();
            const { question, options } = getQuestionAndOptions();

            if (question && ((options.left && options.left.length > 0) || options.length > 0)) {
                // Show spinner
                showSmallSpinner();

                const searchSuggestions = await getSearchSuggestions(title, question, options);
                console.log('Search Suggestions:', searchSuggestions);

                const searchResults = await duckDuckGoSearch(searchSuggestions);
                console.log('Search Results:', searchResults);

                const answer = await getChatGPTAnswerWithSearchResults(title, question, options, searchResults);
                displayAnswer(answer);
            }

            // Hide spinner (in case answer already displayed)
            hideSmallSpinner();
        } else {
            console.log('No question or options found');
        }
    }

    // Call the createSmallSpinner function once to initialize the spinner element
    createSmallSpinner();

    // Function to set API keys
    function setApiKeys() {
        const openaiApiKey = prompt('Enter your OpenAI API key:');
        if (openaiApiKey) {
            localStorage.setItem('openai_api_key', openaiApiKey);
        }
        alert('API key saved successfully!');
    }

    // Register menu command to set API keys
    GM_registerMenuCommand('Set API Keys', setApiKeys);

    // Observe changes in the DOM and rerun main function with debounce
    const debouncedMain = debounce(main, 500);
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length || mutation.removedNodes.length) {
                console.log('DOM changed, running main function');
                debouncedMain();
            }
        });
    });

    // Start observing the entire document for changes
    observer.observe(document.body, { childList: true, subtree: true });

    // Run the main function after the page has fully loaded
    window.addEventListener('load', main);
})();
