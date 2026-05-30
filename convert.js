const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = __dirname;
const TSV_PATH = path.join(ROOT_DIR, '..', 'blog-migration', '20260429-043355', 'content-full.tsv');
const OUTPUT_DIR = path.join(ROOT_DIR, 'posts');
const PAGES_DIR = ROOT_DIR;
const UPLOADS_URL_RE = /https?:\/\/(?:www\.)?quantumofgravity\.com\/blog\/wp-content\/uploads\//g;
const MANAGED_PAGE_STATUSES = new Set(['publish']);
const PAGE_SLUG_ALIASES = {
    'about-2': 'about',
    'research-interests': 'research'
};
const PRESERVED_PAGE_SLUGS = new Set(['blog']);

function normalizeCitationKey(key) {
    return key.trim().replace(/[.,;:]+$/, '');
}

function normalizeCitationGroup(keys) {
    return keys
        .split(',')
        .map(key => normalizeCitationKey(key))
        .filter(Boolean)
        .map(key => `@${key}`);
}

function parseTSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const headers = lines[0].split('\t');

    return lines.slice(1).filter(line => line.trim()).map(line => {
        const values = line.split('\t');
        const obj = {};
        headers.forEach((header, i) => {
            obj[header.trim()] = values[i] ? values[i].trim() : '';
        });
        return obj;
    });
}

function decodeEscapes(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\u00a0/g, ' ');
}

function toLocalUploadsPath(value) {
    return value.replace(UPLOADS_URL_RE, '/wp-content/uploads/');
}

function texTokenFor(index) {
    return `CODEXMATHTOKEN${index}END`;
}

function normalizeTexSegment(segment) {
    let normalized = segment
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n(?=\\|$)/g, '\n')
        .replace(/&amp;/g, '&')
        .replace(/&#92;/g, '\\')
        .replace(/&#123;/g, '{')
        .replace(/&#125;/g, '}')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    const trimmed = normalized.trim();

    if (/^\\begin\{equation\*?\}[\s\S]*\\end\{equation\*?\}$/.test(trimmed)) {
        normalized = trimmed
            .replace(/^\\begin\{equation\*?\}/, '')
            .replace(/\\end\{equation\*?\}$/, '')
            .trim();
        return `\n\n$$\n${normalized}\n$$\n\n`;
    }

    if (/^\\begin\{align\*?\}[\s\S]*\\end\{align\*?\}$/.test(trimmed)) {
        normalized = trimmed
            .replace(/^\\begin\{align\*?\}/, '')
            .replace(/\\end\{align\*?\}$/, '')
            .trim();
        return `\n\n$$\n${normalized}\n$$\n\n`;
    }

    if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) {
        normalized = trimmed.slice(2, -2).trim();
        return `\n\n$$\n${normalized}\n$$\n\n`;
    }

    if (/^\$(?!\$)[\s\S]*\$$/.test(trimmed)) {
        normalized = trimmed.slice(1, -1).trim();
        return `$${normalized}$`;
    }

    return normalized;
}

function protectTexSegments(content) {
    const segments = [];
    const protect = segment => {
        const token = texTokenFor(segments.length);
        segments.push(segment);
        return token;
    };

    let protectedContent = content;

    protectedContent = protectedContent.replace(/\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}/g, protect);
    protectedContent = protectedContent.replace(/\$\$[\s\S]*?\$\$/g, protect);
    protectedContent = protectedContent.replace(/\\\[[\s\S]*?\\\]/g, protect);
    protectedContent = protectedContent.replace(/\\\([\s\S]*?\\\)/g, protect);
    protectedContent = protectedContent.replace(/\$(?!\$)(?:\\.|[^$\\])+\$/g, protect);

    return { protectedContent, segments };
}

function restoreTexSegments(content, segments) {
    return segments.reduce(
        (restored, segment, index) => restored.replace(new RegExp(`\\\\?${texTokenFor(index)}`, 'g'), normalizeTexSegment(segment)),
        content
    );
}

function shortcodeNote(label) {
    return `<p><em>${label}</em></p>`;
}

function extractCaptionImage(inner) {
    const markdownImage = inner.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (markdownImage) {
        return markdownImage[1];
    }

    const htmlImage = inner.match(/<img[^>]+src="([^"]+)"/i);
    if (htmlImage) {
        return htmlImage[1];
    }

    return null;
}

function normalizeCaption(inner) {
    const src = extractCaptionImage(inner);
    const withoutImage = inner
        .replace(/!\[[^\]]*\]\(([^)]+)\)(\{[^}]*\})?/g, '')
        .replace(/<img[^>]*>/gi, '')
        .trim();

    if (!src) {
        return withoutImage;
    }

    const cleanCaption = withoutImage.replace(/\s+/g, ' ').trim();
    const localSrc = toLocalUploadsPath(src);
    if (!cleanCaption) {
        return `<p><img src="${localSrc}" alt="" /></p>`;
    }
    return `<figure><img src="${localSrc}" alt="${cleanCaption}" /><figcaption>${cleanCaption}</figcaption></figure>`;
}

function preprocessWordpressContent(rawContent) {
    if (!rawContent) {
        return '';
    }

    const { protectedContent, segments } = protectTexSegments(rawContent);
    let content = decodeEscapes(protectedContent);

    content = content.replace(/<!--\s*wp:[\s\S]*?-->/g, '');
    content = content.replace(/<!--\s*\/wp:[\s\S]*?-->/g, '');
    content = content.replace(/\[bibcite key=([^\]]+)\]/g, (_, keys) => {
        const keyList = normalizeCitationGroup(keys);
        return keyList.length ? `[${keyList.join('; ')}]` : '';
    });
    content = content.replace(/\[bibshow[^\]]*\]/g, '');
    content = content.replace(/\[ppcnote\]([\s\S]*?)\[\/ppcnote\]/g, (_, note) => `(${note.trim()})`);
    content = content.replace(/\[contact-form-7[^\]]*\]/g, shortcodeNote('Contact form omitted from the static migration.'));
    content = content.replace(/\[table id=([^\]\s]+)[^\]]*\s*\/?\]/g, (_, id) => shortcodeNote(`Table omitted from the static migration: ${id}.`));
    content = content.replace(/\[gallery[^\]]*\]/g, shortcodeNote('Image gallery omitted from the static migration.'));
    content = content.replace(/\[embed\](https?:\/\/[^\[]+)\[\/embed\]/g, (_, url) => `<p><a href="${url.trim()}">${url.trim()}</a></p>`);
    content = content.replace(/\[gist\s+([^\]\s]+)[^\]]*\]/g, (_, url) => `<p><a href="${url.trim()}">${url.trim()}</a></p>`);
    content = content.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/g, (_, inner) => normalizeCaption(inner));
    content = content.replace(/URLhttps?:\/\//g, 'https://');
    content = content.replace(/URLhttp?:\/\//g, 'http://');
    content = toLocalUploadsPath(content);
    content = content.replace(/\n{3,}/g, '\n\n');
    content = restoreTexSegments(content, segments);

    return content.trim();
}

function convertHtmlToMarkdown(html) {
    if (!html) {
        return '';
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarto-convert-'));
    const tempHtmlFile = path.join(tempDir, 'input.html');

    fs.writeFileSync(tempHtmlFile, html);

    try {
        return execFileSync(
            'pandoc',
            ['-f', 'html', '-t', 'markdown+tex_math_dollars', '--wrap=none', tempHtmlFile],
            { encoding: 'utf-8' }
        );
    } catch (err) {
        console.error('Pandoc conversion failed:', err.message);
        return html;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function postProcessMarkdown(content) {
    if (!content) {
        return '';
    }

    let cleaned = content;

    const normalizeMathBody = body => body
        .replace(/\\{2,}([A-Za-z])/g, '\\$1')
        .replace(/\\([_^])/g, '$1')
        .replace(/\\~/g, '~')
        .replace(/\\>/g, '>')
        .replace(/\\</g, '<')
        .trim();

    cleaned = cleaned.replace(/\\\[@/g, '[@');
    cleaned = cleaned.replace(/\\@/g, '@');
    cleaned = cleaned.replace(/\\\[/g, '[');
    cleaned = cleaned.replace(/\\\]/g, ']');
    cleaned = cleaned.replace(/\\"/g, '"');
    cleaned = cleaned.replace(/\\'/g, "'");
    cleaned = cleaned.replace(/\\\\([A-Za-z])/g, (_, letter) => `\\${letter}`);
    cleaned = cleaned.replace(/\[([^\]]+)\]\{#fn-[^}]+\}/g, '$1');
    cleaned = cleaned.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, body) => `$$\n${body.trim()}\n$$`);
    cleaned = cleaned.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_, body) => `$$\n${body.trim()}\n$$`);
    cleaned = cleaned.replace(/\\+ref\{/g, '\\ref{');
    cleaned = cleaned.replace(/\\\$(.+?)\\\$/gs, (_, body) => {
        const normalized = normalizeMathBody(body);
        if (normalized.includes('\n') || normalized.includes('\\label{')) {
            return `\n\n$$\n${normalized}\n$$\n\n`;
        }
        return `$${normalized}$`;
    });
    cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => `\n\n$$\n${normalizeMathBody(body)}\n$$\n\n`);
    cleaned = cleaned.replace(/\$([^$\n]+)\$/g, (_, body) => `$${normalizeMathBody(body)}$`);
    cleaned = cleaned.replace(/\$\s+([^$\n]+?)\s+\$/g, (_, body) => `$${body.trim()}$`);
    cleaned = cleaned.replace(/::: \{#note1\}\n\\\*\n\n/g, '- *: ');
    cleaned = cleaned.replace(/::: \{#note5\}\n\\\*\\\*\n\n/g, '- **: ');
    cleaned = cleaned.replace(/::: \{#note2\}\n†\n\n/g, '- †: ');
    cleaned = cleaned.replace(/::: \{#note3\}\n‡\n\n/g, '- ‡: ');
    cleaned = cleaned.replace(/::: \{#note4\}\n§\n\n/g, '- §: ');
    cleaned = cleaned.replace(/^\s*-\s*$/gm, '');
    cleaned = cleaned.replace(/^\s*\d+\.\s*$/gm, '');
    cleaned = cleaned.replace(/\[↩\]\([^)]+\)/g, '');
    cleaned = cleaned.replace(/\{\.jetpack-footnote\}/g, '');
    cleaned = cleaned.replace(/^::: footnotes$/gm, '');
    cleaned = cleaned.replace(/^::: \{#fn-[^}]+\}$/gm, '');
    cleaned = cleaned.replace(/^:::$\n?/gm, '');
    cleaned = cleaned.replace(/\n[ \t]+\n/g, '\n\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/\[@([^\]]+)\]/g, (_, keys) => {
        const normalized = keys
            .split(';')
            .map(key => key.trim().replace(/^@/, ''))
            .map(normalizeCitationKey)
            .filter(Boolean)
            .map(key => `@${key}`);
        return normalized.length ? `[${normalized.join('; ')}]` : '';
    });

    return cleaned.trim();
}

function processContent(rawContent) {
    const normalizedHtml = preprocessWordpressContent(rawContent);
    const { protectedContent, segments } = protectTexSegments(normalizedHtml);
    const markdown = convertHtmlToMarkdown(protectedContent);
    const restoredMarkdown = restoreTexSegments(markdown, segments);
    return postProcessMarkdown(restoredMarkdown);
}

function escapeYamlString(value) {
    return String(value).replace(/"/g, '\\"');
}

function removeIfExists(targetPath) {
    if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true });
    }
}

function cleanupStalePages(data) {
    data.forEach(entry => {
        if (entry.post_type !== 'page') {
            return;
        }

        const originalSlug = entry.post_name || `post-${entry.ID}`;
        const canonicalSlug = PAGE_SLUG_ALIASES[entry.post_name] || originalSlug;
        const originalFile = path.join(PAGES_DIR, `${originalSlug}.qmd`);
        const canonicalFile = path.join(PAGES_DIR, `${canonicalSlug}.qmd`);
        const shouldKeepCanonical = MANAGED_PAGE_STATUSES.has(entry.post_status);

        if (!shouldKeepCanonical) {
            removeIfExists(originalFile);
            if (canonicalFile !== originalFile) {
                removeIfExists(canonicalFile);
            }
            return;
        }

        if (canonicalFile !== originalFile) {
            removeIfExists(originalFile);
        }
    });
}

function main() {
    const data = parseTSV(TSV_PATH);
    console.log(`Found ${data.length} entries.`);
    cleanupStalePages(data);

    data.forEach(entry => {
        const isPage = entry.post_type === 'page';
        const isManagedPage = isPage && MANAGED_PAGE_STATUSES.has(entry.post_status);
        const isManagedPost = entry.post_type === 'post' && entry.post_status === 'publish';

        if (!isManagedPage && !isManagedPost) {
            return;
        }

        const date = entry.post_date.split(' ')[0];
        const slug = PAGE_SLUG_ALIASES[entry.post_name] || entry.post_name || `post-${entry.ID}`;

        if (isPage && PRESERVED_PAGE_SLUGS.has(slug)) {
            return;
        }

        const title = escapeYamlString(entry.post_title);
        const mdContent = processContent(entry.post_content);

        const yamlFrontMatter = [
            '---',
            `title: "${title}"`,
            `date: "${date}"`,
            isPage ? '' : `categories: []`,
            `slug: "${slug}"`,
            '---',
            '',
            mdContent
        ].filter(line => line !== '').join('\n');
        
        if (isPage) {
            const fileName = `${slug}.qmd`;
            fs.writeFileSync(path.join(PAGES_DIR, fileName), yamlFrontMatter);
            console.log(`Created page: ${fileName}`);
        } else {
            const postDir = path.join(OUTPUT_DIR, `${date}-${slug}`);
            if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });
            fs.writeFileSync(path.join(postDir, 'index.qmd'), yamlFrontMatter);
            console.log(`Created post: ${date}-${slug}`);
        }
    });
}

main();
