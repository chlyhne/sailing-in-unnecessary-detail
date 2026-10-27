-- Append the newest published article to the home page at render time.
local function published_posts(directory, posts)
  local is_directory, entries = pcall(pandoc.system.list_directory, directory)
  if not is_directory then return end
  for _, name in ipairs(entries) do
    local path = pandoc.path.join({directory, name})
    if name:match("%.qmd$") then
      local file = assert(io.open(path, "r"))
      local post = pandoc.read(file:read("*a"), "markdown")
      file:close()
      local date = pandoc.utils.stringify(post.meta.date or "")
      if post.meta.draft ~= true and date:match("^%d%d%d%d%-%d%d%-%d%d$") then
        posts[#posts + 1] = {path = path, date = date, doc = post}
      end
    else
      published_posts(path, posts)
    end
  end
end

function Pandoc(doc)
  local posts = {}
  published_posts("posts", posts)
  table.sort(posts, function(a, b)
    if a.date == b.date then return a.path < b.path end
    return a.date > b.date
  end)
  local latest = posts[1]
  if not latest then return doc end

  local directory = pandoc.path.directory(latest.path)
  local permalink = latest.path:gsub("%.qmd$", ".html")
  local function rebase(target)
    if target:match("^[/#]") or target:match("^[%a][%w+.-]*:") then
      return target
    end
    local path, suffix = target:match("^([^?#]*)(.*)$")
    local parts = {}
    for part in (directory .. "/" .. path):gmatch("[^/]+") do
      if part == ".." then
        table.remove(parts)
      elseif part ~= "." then
        parts[#parts + 1] = part
      end
    end
    return table.concat(parts, "/"):gsub("%.qmd$", ".html") .. suffix
  end

  -- The article's return link is redundant on the home page.
  local first = latest.doc.blocks[1]
  if first and first.t == "Para" and #first.content == 1
      and first.content[1].t == "Link"
      and rebase(first.content[1].target) == "index.html" then
    latest.doc.blocks:remove(1)
  end

  local article = latest.doc:walk({
    Header = function(header)
      header.level = math.min(header.level + 1, 6)
      return header
    end,
    Image = function(image)
      image.src = rebase(image.src)
      return image
    end,
    Link = function(link)
      link.target = rebase(link.target)
      return link
    end
  })
  local title = latest.doc.meta.title or pandoc.MetaInlines({pandoc.Str("Latest post")})
  local blocks = pandoc.Blocks({
    pandoc.Para({pandoc.Span("Latest post", pandoc.Attr("", {"post-meta"}))}),
    pandoc.Header(2, {pandoc.Link(title, permalink)}),
    pandoc.Para({pandoc.Span(latest.date, pandoc.Attr("", {"post-meta"}))})
  })
  blocks:extend(article.blocks)
  doc.blocks:insert(pandoc.Div(blocks, pandoc.Attr("latest-post", {"latest-post"})))
  return doc
end
