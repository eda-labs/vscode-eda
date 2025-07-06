export const nodeConfigScripts = `
    const vscode = acquireVsCodeApi();
    const configView = document.getElementById('configView');
    const toggleBtn = document.getElementById('toggleAnnotations');
    const copyBtn = document.getElementById('copyConfig');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const colorModeSelect = document.getElementById('colorModeSelect');
    let colorMode = '\${colorMode}';
    document.body.classList.add(\`color-mode-\${colorMode}\`);
    colorModeSelect.value = colorMode;
    
    const annotationLineMap = new Map();
    const annotationInfoMap = new Map();
    let isAnnotationsVisible = true;
    let configText = '';
    
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'loadData') {
        configText = message.config;
        if (message.colorMode) {
          colorMode = message.colorMode;
          document.body.classList.remove('color-mode-full', 'color-mode-less', 'color-mode-none');
          document.body.classList.add(\`color-mode-\${colorMode}\`);
          colorModeSelect.value = colorMode;
        }
        render(message.config, message.annotations);
      }
    });
    
    toggleBtn.addEventListener('click', () => {
      isAnnotationsVisible = !isAnnotationsVisible;

      if (isAnnotationsVisible) {
        configView.classList.remove('annotations-hidden');
        configView.classList.add('annotations-visible');
        toggleBtn.innerHTML = '<span class="button-icon">⊞</span><span>Hide Annotations</span>';
      } else {
        configView.classList.remove('annotations-visible');
        configView.classList.add('annotations-hidden');
        toggleBtn.innerHTML = '<span class="button-icon">⊞</span><span>Show Annotations</span>';

        // Remove any highlight when annotations are hidden
        configView.querySelectorAll('.line-highlight').forEach(el => {
          el.classList.remove('line-highlight');
        });
      }
    });
    
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(configText).then(() => {
        showToast('Config copied to clipboard');
        copyBtn.classList.add('copy-success');

        setTimeout(() => {
          copyBtn.classList.remove('copy-success');
        }, 1000);
      });
    });

    colorModeSelect.addEventListener('change', () => {
      const mode = colorModeSelect.value;
      document.body.classList.remove('color-mode-full', 'color-mode-less', 'color-mode-none');
      document.body.classList.add(\`color-mode-\${mode}\`);
      vscode.postMessage({ command: 'saveColorMode', colorMode: mode });
    });
    
    function showToast(message) {
      toastMessage.textContent = message;
      toast.classList.add('show');
      
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
    
    function render(config, annotations) {
      const lines = config.split('\\n');
      const annotationMap = buildAnnotationMap(lines.length, annotations);
      
      configView.innerHTML = '';
      const fragment = document.createDocumentFragment();
      
      // Track the current context to improve highlighting
      let currentContext = {
        section: '',
        interface: '',
        subBlock: '',
        level: 0
      };
      
      // Track the previous annotation for section dividers
      let lastAnnotation = '';
      let previousAnnotation = '';

      for (let index = 0; index < lines.length; ) {
        const lineNum = index + 1;
        const annotationNames = annotationMap[index] || [];
        const annotationKey = annotationNames.join('|');
        const showLabel = annotationKey && annotationKey !== previousAnnotation;

        // Determine how many subsequent lines share the same annotation
        let groupLength = 1;
        while (
          index + groupLength < lines.length &&
          (annotationMap[index + groupLength] || []).join('|') === annotationKey
        ) {
          groupLength++;
        }

        // Add section divider when annotation changes
        if (showLabel && lastAnnotation) {
          const divider = document.createElement('div');
          divider.className = 'divider';
          divider.style.gridColumn = '1 / -1';
          fragment.appendChild(divider);
        }

        const annInfos = annotationNames.map(name => ({
          name,
          info: annotationInfoMap.get(name),
          separateLine: false,
        }));

        let leftoverLines = groupLength - annotationNames.length;
        for (const item of annInfos) {
          if (
            item.info &&
            item.info.group &&
            item.info.version &&
            item.info.kind &&
            leftoverLines > 0
          ) {
            item.separateLine = true;
            leftoverLines--;
          }
        }

        const pendingInfos = [];

        for (let i = 0; i < groupLength; i++) {
          const currentIndex = index + i;
          const currentLine = lines[currentIndex];
          const currentLineNum = currentIndex + 1;

          // Update context tracking
          updateContext(currentLine, currentContext);

          const lineEl = document.createElement('div');
          lineEl.className = 'line';
          lineEl.dataset.line = currentLineNum;

          if (annotationKey) {
            lineEl.dataset.annotation = annotationKey;
          }

          const annotationEl = document.createElement('div');
          annotationEl.className = 'line-annotation';

          if (i < annInfos.length) {
            const item = annInfos[i];
            const info = item.info;
            if (info && info.group && info.version && info.kind) {
              if (item.separateLine) {
                annotationEl.textContent = item.name;
                pendingInfos.push(info);
              } else {
                annotationEl.innerHTML =
                  item.name +
                  '<br><span class="annotation-info">' +
                  info.group +
                  '/' +
                  info.version +
                  ' ' +
                  info.kind +
                  '</span>';
              }
            } else {
              annotationEl.textContent = item.name;
            }
          } else if (pendingInfos.length > 0) {
            const info = pendingInfos.shift();
            annotationEl.innerHTML =
              '<span class="annotation-info">' +
              info.group +
              '/' +
              info.version +
              ' ' +
              info.kind +
              '</span>';
            
          } else {
            annotationEl.textContent = '';
          }
          annotationEl.dataset.annotation = annotationKey;

          const numEl = document.createElement('div');
          numEl.className = 'line-num';
          numEl.textContent = currentLineNum;

          const codeEl = document.createElement('div');
          codeEl.className = 'line-code';
          codeEl.innerHTML = applySyntaxHighlighting(currentLine, currentContext);

          lineEl.appendChild(annotationEl);
          lineEl.appendChild(numEl);
          lineEl.appendChild(codeEl);

          fragment.appendChild(lineEl);
        }

        // Extra annotation owners beyond available lines
        if (annotationNames.length > groupLength) {
          const targetLineNum = index + groupLength; // highlight with last line
          for (let i = groupLength; i < annotationNames.length; i++) {
            const extraLineEl = document.createElement('div');
            extraLineEl.className = 'line annotation-extra';
            extraLineEl.dataset.line = String(targetLineNum);
            extraLineEl.dataset.annotation = annotationKey;

            const extraAnnEl = document.createElement('div');
            extraAnnEl.className = 'line-annotation';
            const extraName = annotationNames[i];
            const info = annotationInfoMap.get(extraName);
            if (info && info.group && info.version && info.kind) {
              extraAnnEl.innerHTML =
                extraName +
                '<br><span class="annotation-info">' +
                info.group +
                '/' +
                info.version +
                ' ' +
                info.kind +
                '</span>';
            } else {
              extraAnnEl.textContent = extraName;
            }
            extraAnnEl.dataset.annotation = annotationKey;

            const blankNumEl = document.createElement('div');
            blankNumEl.className = 'line-num';
            blankNumEl.style.visibility = 'hidden';
            blankNumEl.textContent = '';

            const blankCodeEl = document.createElement('div');
            blankCodeEl.className = 'line-code';
            blankCodeEl.style.visibility = 'hidden';
            blankCodeEl.textContent = '';

            extraLineEl.appendChild(extraAnnEl);
            extraLineEl.appendChild(blankNumEl);
            extraLineEl.appendChild(blankCodeEl);

            fragment.appendChild(extraLineEl);
          }
        }

        previousAnnotation = annotationKey;
        if (annotationKey) {
          lastAnnotation = annotationKey;
        }

        index += groupLength;
      }
      
      configView.appendChild(fragment);
      setupEventListeners();
    }
    
    function updateContext(line, context) {
      const trimmedLine = line.trim();
      const indentLevel = line.search(/\\S|$/);
      
      // Calculate the nesting level based on indentation
      context.level = Math.floor(indentLevel / 4);
      
      // Check for main section declarations
      if (context.level === 0 && trimmedLine.match(/^\\w+.*\\{$/)) {
        context.section = trimmedLine.split(' ')[0];
        context.interface = '';
        context.subBlock = '';
      } 
      // Check for interface declarations
      else if (context.level === 0 && trimmedLine.startsWith('interface ')) {
        context.section = 'interface';
        context.interface = trimmedLine.split(' ')[1];
        context.subBlock = '';
      }
      // Check for sub-blocks
      else if (context.level === 1 && trimmedLine.endsWith('{')) {
        context.subBlock = trimmedLine.split(' ')[0];
      }
      // Reset contexts at closing braces
      else if (trimmedLine === '}') {
        if (context.level === 0) {
          context.section = '';
          context.interface = '';
          context.subBlock = '';
        } else if (context.level === 1) {
          context.subBlock = '';
        }
      }
    }
    
    function applySyntaxHighlighting(line, context) {
      // Check for empty lines
      if (line.trim() === '') {
        return '';
      }
      
      // Create indentation guides based on indentation level
      const indentLevel = line.search(/\\S|$/);
      let indentGuides = '';
      for (let i = 0; i < indentLevel; i += 4) {
        indentGuides += '<span class="indentation-guide" style="left:' + i + 'px"></span>';
      }
      
      // Escape HTML for safety
      let processedLine = escapeHtml(line);
      
      // Handle comments
      if (processedLine.trim().startsWith('#')) {
        return indentGuides + '<span class="comment">' + processedLine + '</span>';
      }
      
      // First identify the line type
      if (context.level === 0) {
        // Main section declarations (bfd, interface, network-instance, etc.)
        if (processedLine.match(/^(\\s*)(\\w+)\\s+([\\w\\-\\/]+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w+)\\s+([\\w\\-\\/\\.]+)\\s*\\{/, function(match, space, keyword, name) {
            if (keyword === 'interface') {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            } else if (keyword === 'network-instance') {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            } else {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            }
          });
        } 
        // Main section with no identifier
        else if (processedLine.match(/^(\\s*)(\\w+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w+)\\s*\\{/, '$1<span class="section-keyword">$2</span> <span class="bracket">{</span>');
        }
      } else {
        // Subsections with blocks
        if (processedLine.match(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/)) {
          // Different styling based on the context
          if (context.section === 'interface' || context.section === 'bfd') {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="property">$2</span> <span class="bracket">{</span>');
          } else if (context.section === 'network-instance') {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="network-keyword">$2</span> <span class="bracket">{</span>');
          } else {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="property">$2</span> <span class="bracket">{</span>');
          }
        }
        // Special handling for specific subsections
        else if (processedLine.match(/^(\\s*)(\\w[\\w\\-\\/\\.]+)\\s+(.+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-\\/\\.]+)\\s+(.+)\\s*\\{/, function(match, space, keyword, rest) {
            // Special coloring for specific properties
            if (keyword === 'subinterface') {
              return space + '<span class="property">' + keyword + '</span> <span class="value">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            } else if (keyword === 'address') {
              return space + '<span class="property">' + keyword + '</span> <span class="ip-address">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            } else {
              return space + '<span class="property">' + keyword + '</span> <span class="value">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            }
          });
        }
        // Key-value pairs (no nested block)
        else if (processedLine.match(/^(\\s*)(\\w[\\w\\-]+)\\s+(.+)$/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s+(.+)$/, function(match, space, property, value) {
            // Format based on value type
            if (value === 'true' || value === 'false') {
              return space + '<span class="property">' + property + '</span> <span class="boolean">' + value + '</span>';
            } else if (value === 'enable' || value === 'disable' || value === 'up' || value === 'down') {
              return space + '<span class="property">' + property + '</span> <span class="boolean">' + value + '</span>';
            } else if (value.match(/^\\d+$/)) {
              return space + '<span class="property">' + property + '</span> <span class="number">' + value + '</span>';
            } else if (value.match(/^".*"$/)) {
              return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
            } else if (value.match(/^\\d+\\.\\d+\\.\\d+\\.\\d+\\/\\d+$/)) {
              return space + '<span class="property">' + property + '</span> <span class="ip-address">' + value + '</span>';
            } else if (context.section === 'bfd' || property === 'admin-state') {
              return space + '<span class="parameter">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property === 'description') {
              return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
            } else if (property.includes('vlan')) {
              return space + '<span class="vlan">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (context.section === 'network-instance' && context.subBlock === 'protocols') {
              return space + '<span class="protocol">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property.includes('bgp')) {
              return space + '<span class="bgp">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property.includes('route')) {
              return space + '<span class="route">' + property + '</span> <span class="value">' + value + '</span>';
            } else {
              return space + '<span class="property">' + property + '</span> <span class="value">' + value + '</span>';
            }
          });
        }
        // Arrays in the config
        else if (processedLine.match(/^(\\s*)\\[$/)) {
          processedLine = processedLine.replace(/^(\\s*)\\[$/, '$1<span class="bracket">[</span>');
        }
        else if (processedLine.match(/^(\\s*)\\]$/)) {
          processedLine = processedLine.replace(/^(\\s*)\\]$/, '$1<span class="bracket">]</span>');
        }
        else if (processedLine.match(/^(\\s*)(\\w.*)$/)) {
          const trimmed = processedLine.trim();
          if (trimmed.match(/^\\d+$/)) {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="number">$2</span>');
          } else if (trimmed.match(/^\\d+\\.\\d+\\.\\d+\\.\\d+$/)) {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="ip-address">$2</span>');
          } else if (trimmed === 'enable' || trimmed === 'disable' || trimmed === 'up' || trimmed === 'down') {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="boolean">$2</span>');
          } else {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="value">$2</span>');
          }
        }
      }
      
      // Handle closing braces
      if (processedLine.trim() === '}') {
        processedLine = processedLine.replace(/^(\\s*)\\}$/, '$1<span class="bracket">}</span>');
      }
      
      return indentGuides + processedLine;
    }
    
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    
    function buildAnnotationMap(numLines, annotations) {
      const annMap = Array.from({ length: numLines }, () => new Set());
      annotationLineMap.clear();
      annotationInfoMap.clear();

      for (const ann of annotations) {
        const label = ann.cr?.name || 'unknown';
        const info = {
          name: ann.cr?.name || 'unknown',
          group: ann.cr?.gvk?.group || '',
          version: ann.cr?.gvk?.version || '',
          kind: ann.cr?.gvk?.kind || '',
        };

        if (!annotationLineMap.has(label)) {
          annotationLineMap.set(label, new Set());
          annotationInfoMap.set(label, info);
        }

        for (const range of ann.lines) {
          let start = range.startLine;
          let end = range.endLine;

          if (start === undefined && end !== undefined) {
            // API uses zero-based indexing
            start = 0;
          }

          if (end === undefined && start !== undefined) {
            end = start;
          }

          if (start === undefined || end === undefined) {
            continue;
          }

          if (start > end) {
            const tmp = start;
            start = end;
            end = tmp;
          }

          for (
            let i = Math.max(0, start);
            i <= Math.min(numLines - 1, end);
            i++
          ) {
            annMap[i].add(label);
            annotationLineMap.get(label).add(i + 1);
          }
        }
      }
      return annMap.map(set => Array.from(set));
    }
    
    function setupEventListeners() {
      configView.addEventListener('mouseover', e => {
        const targetLine = e.target.closest('.line');
        const relatedLine = e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest('.line')
          : null;
        const currentAnn = targetLine && targetLine.dataset.annotation;
        const relatedAnn = relatedLine && relatedLine.dataset.annotation;
        if (currentAnn && currentAnn !== relatedAnn) {
          highlightLines(currentAnn, true);
        }
      });

      configView.addEventListener('mouseout', e => {
        const targetLine = e.target.closest('.line');
        const relatedLine = e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest('.line')
          : null;
        const currentAnn = targetLine && targetLine.dataset.annotation;
        const relatedAnn = relatedLine && relatedLine.dataset.annotation;
        if (currentAnn && currentAnn !== relatedAnn) {
          highlightLines(currentAnn, false);
        }
      });
    }
    
    function highlightLines(annotationNamesStr, shouldHighlight) {
      if (!isAnnotationsVisible) {
        return;
      }

      const names = annotationNamesStr.split("|");
      for (const name of names) {
        const lineNumbers = annotationLineMap.get(name);
        if (!lineNumbers) continue;
        lineNumbers.forEach(lineNum => {
          const lineEls = configView.querySelectorAll(\`.line[data-line="\${lineNum}"]\`);
          lineEls.forEach(el => {
            el.classList.toggle("line-highlight", shouldHighlight);
          });
        });
      }
    }
`;
