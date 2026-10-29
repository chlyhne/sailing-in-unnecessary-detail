-- Build one article index and conditionally show the newest draft on the home page.
local root = quarto.project.directory

local function read_posts(directory, posts)
  local is_directory, entries = pcall(pandoc.system.list_directory, pandoc.path.join({root, directory}))
  if not is_directory then return end
  for _, name in ipairs(entries) do
    local path = pandoc.path.join({directory, name})
    if name:match("%.qmd$") then
      local file = assert(io.open(pandoc.path.join({root, path}), "r"))
      local post = pandoc.read(file:read("*a"), "markdown")
      file:close()
      local date = pandoc.utils.stringify(post.meta.date or "")
      if date:match("^%d%d%d%d%-%d%d%-%d%d$") then
        posts[#posts + 1] = {path = path, date = date, doc = post, draft = post.meta.draft == true}
      end
    else
      read_posts(path, posts)
    end
  end
end

local function permalink(post)
  return "/" .. post.path:gsub("%.qmd$", ".html")
end

local function title(post)
  return post.doc.meta.title or pandoc.MetaInlines({pandoc.Str("Untitled post")})
end

local function date_label(value)
  local year, month, day = value:match("^(%d+)%-(%d+)%-(%d+)$")
  return os.date("%d %B %Y", os.time({year = year, month = month, day = day})):gsub("^0", "")
end

local function article(post)
  local directory = pandoc.path.directory(post.path)
  local function rebase(target)
    if target:match("^[/#]") or target:match("^[%a][%w+.-]*:") then return target end
    local path, suffix = target:match("^([^?#]*)(.*)$")
    local parts = {}
    for part in (directory .. "/" .. path):gmatch("[^/]+") do
      if part == ".." then table.remove(parts)
      elseif part ~= "." then parts[#parts + 1] = part end
    end
    return "/" .. table.concat(parts, "/"):gsub("%.qmd$", ".html") .. suffix
  end

  local first = post.doc.blocks[1]
  if first and first.t == "Para" and #first.content == 1
      and first.content[1].t == "Link" and rebase(first.content[1].target) == "/index.html" then
    post.doc.blocks:remove(1)
  end
  local body = post.doc:walk({
    Header = function(header)
      header.level = math.min(header.level + 1, 6)
      return header
    end,
    Image = function(image) image.src = rebase(image.src); return image end,
    Link = function(link) link.target = rebase(link.target); return link end
  })
  local heading = pandoc.Inlines({pandoc.Link(title(post), permalink(post))})
  if post.draft then
    -- Quarto unlinks drafts. The owner script supplies this link when showing it.
    heading = pandoc.Inlines({pandoc.RawInline("html", '<a data-draft-href="' .. permalink(post) .. '">')})
    heading:extend(title(post))
    heading:insert(pandoc.RawInline("html", "</a>"))
  end
  local blocks = pandoc.Blocks({
    pandoc.Para({pandoc.Span("Latest post", pandoc.Attr("", {"post-meta"}))}),
    pandoc.Header(2, heading),
    pandoc.Para({pandoc.Span(date_label(post.date), pandoc.Attr("", {"post-meta"}))})
  })
  blocks:extend(body.blocks)
  -- Render each article separately so Pandoc's endnotes stay inside it when
  -- owner view replaces the published article with a draft on the home page.
  local html = pandoc.write(pandoc.Pandoc(blocks), "html", {html_math_method = "mathml"})
  return pandoc.Div({pandoc.RawBlock("html", html)}, pandoc.Attr("latest-post", {"latest-post"},
    {["data-comments-post"] = permalink(post)}))
end

function Pandoc(doc)
  local posts = {}
  read_posts("posts", posts)
  table.sort(posts, function(a, b)
    if a.date == b.date then return a.path < b.path end
    return a.date > b.date
  end)
  local entries = {}
  local published
  for _, post in ipairs(posts) do
    local link = pandoc.write(pandoc.Pandoc({pandoc.Plain({pandoc.Link(title(post), permalink(post))})}), "html")
    if post.draft then link = link:gsub("href=", "data-draft-href=", 1) end
    entries[#entries + 1] = '<li' .. (post.draft and ' data-draft hidden' or '') .. '>' .. link
      .. '<time datetime="' .. post.date .. '">' .. date_label(post.date) .. '</time></li>'
    if not post.draft and not published then published = post end
  end
  local file = assert(io.open(pandoc.path.join({root, "_includes/header.html"}), "r"))
  local header = file:read("*a")
  file:close()
  header = header:gsub("<!%-%- article%-list %-%->", function() return table.concat(entries, "\n") end)
  quarto.doc.include_text("before-body", header)

  if quarto.doc.input_file == pandoc.path.join({root, "index.qmd"}) then
    if published then doc.blocks:insert(article(published)) end
    local newest = posts[1]
    if newest and newest.draft then
      local html = pandoc.write(pandoc.Pandoc({article(newest)}), "html", {html_math_method = "mathml"})
      quarto.doc.include_text("after-body", '<template id="owner-latest-post">' .. html .. '</template>')
    end
  end
  return doc
end
