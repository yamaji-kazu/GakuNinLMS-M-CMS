const xml2js = require('xml2js');
const {config} = require('./config.js');
const {logger} = require('./log.js');

function p2strings(p){
  if (typeof p === 'undefined'){
    return [];
  }

  // empty object -> empty string
  const ret = p.map(s => typeof s === 'string'?s:'');

  // check total number of characters
  if (ret.reduce((ac,s) => ac + s.length,0) === 0){
    return [];
  }
  return ret;
}

function tika2slide(tika) {
  const ret = [];
  const {div} = tika.html.body;
  let content, note;
  for (const e of div){
    switch(e.class){
      case 'slide-content':
        content = p2strings(e.p);
        break;
      case 'slide-notes':
        note = p2strings(e.p);
        ret.push({content, note});
        break;
    }
  }
  return ret;
}

const metaKeys = ['delay','pad','fade','language','voice','sampleRate','section','topic','license','createdAt','updatedAt','keywords'];
const headerRE = /^\s*(?<key>\w+)\s*:\s*(?<value>.*)$/;
const blockNames = ['description','text','caption'];
const blockRE = /```\s*(?<blockname>.*)\s*$/;

function parseHeader(line) {
  const result = line.match(headerRE);
  if (result !== null) {
    for (key of metaKeys) {
      if (key.toLowerCase() === result.groups.key.toLowerCase()) {
        return {
          key,
          value: result.groups.value
        }
      }
    }
    return {};
  }
  return null;
}

function parseBlock(line) {
  const result = line.match(blockRE);
  if (result !== null) {
    return result.groups.blockname;
  }
  return null;
}

function parseNote(slide) {
  slide.blocks = [];

  let inHeader = true;
  let currentBlock = null;
  slide.note.forEach(line => {
    // parse header
    if (inHeader) {
      const kv = parseHeader(line);
      if (kv !== null) {
        if (kv.key === 'keywords') {
          slide[kv.key] = kv.value.split(/\W+/).filter(s => s.length > 0);
        } else if (typeof kv.key !== 'undefined'){
          slide[kv.key] = kv.value;
        }
        return;
      } else if (line.length > 0) {
        inHeader = false;
      }
    }
    let pb = parseBlock(line);
    if (currentBlock === null) {
      // block start
      if (pb !== null) {
        // default type is text
        if (pb.length === 0){
          pb = "text";
        }
        if (!blockNames.includes(pb)) {
          logger.warn('unknown block type ' + pb);
        }
        currentBlock = {type: pb, content: []};
        slide.blocks.push(currentBlock);
      }
    } else {
      if (pb === null) {
        // add line to block
        currentBlock.content.push(line);
      } else {
        // block end
        currentBlock = null;
      }
    }
  });
}

function newSection(slide) {
  let name = '';
  if (slide.content.length > 0) {
    name = slide.content[0];
  }
  if (typeof slide.section !== 'undefined') {
    name = slide.section;
  }
  return {name, topics: []};
}

function topicName(slide) {
  let name = '';
  if (slide.content.length > 0) {
    name = slide.content[0];
  }
  if (typeof slide.topic !== 'undefined') {
    name = slide.topic;
  }
  return name;
}

function newTopic(slide) {
  return {name: topicName(slide), slides: [slide]};
}

function parseSections(slides) {
  const sections = [];
  let currentSection = null;
  let currentTopic = null;

  slides.forEach(slide => {
    // check new section
    if (currentSection !== null && (slide.content.length === 1 || typeof slide.section !== 'undefined')){
      currentSection = null;
      currentTopic = null;
    }
    // create new section
    if (currentSection === null) {
      currentSection = newSection(slide);
      sections.push(currentSection);
    }
    // check new topic
    if (currentTopic !== null && currentTopic.name !== topicName(slide)) {
      currentTopic = null;
    }
    // create topic
    if (currentTopic === null) {
      currentTopic = newTopic(slide);
      currentSection.topics.push(currentTopic);
      return;
    }
    currentTopic.slides.push(slide);
  });

  return sections;
}

function parseSectionsPerTopic(slides) {
  const sections = [];
  let currentTopic = null;

  slides.forEach(slide => {
    // check new topic
    if (currentTopic !== null && currentTopic.name !== topicName(slide)) {
      currentTopic = null;
    }
    // create new section and topic
    if (currentTopic === null) {
      const currentSection = newSection(slide);
      currentSection.name = '';
      currentTopic = newTopic(slide);
      currentSection.topics.push(currentTopic);
      sections.push(currentSection);
      return;
    }
    currentTopic.slides.push(slide);
  });

  return sections;
}

async function parse(xml) {
  const option = {
    async: false,
    explicitArray: false,
    mergeAttrs: true,
  };
  const tika = await xml2js.parseStringPromise(xml, option);
  const slides = tika2slide(tika);

  slides.forEach(slide => parseNote(slide));

  let sections;
  if (config.sectionPerTopic) {
    sections = parseSectionsPerTopic(slides);
  } else {
    sections = parseSections(slides);
  }

  return {tika, slides, sections};
}

module.exports = {
  parse
}
