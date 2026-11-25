<?php
// Builds the <title> and meta description tags of a page.
function seo_meta(string $titre, string $description): string
{
    return '<title>' . htmlspecialchars($titre, ENT_QUOTES, 'UTF-8') . "</title>\n"
        . '<meta name="description" content="' . htmlspecialchars($description, ENT_QUOTES, 'UTF-8') . '">';
}
