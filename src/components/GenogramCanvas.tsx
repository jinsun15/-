import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';
import { Member, Relationship, GenogramData } from '../types';
import { Download } from 'lucide-react';

interface Props {
  data: GenogramData;
}

export interface GenogramCanvasRef {
  downloadPNG: () => void;
  copyPNG: () => Promise<boolean>;
  resetView: () => void;
}

export const GenogramCanvas = forwardRef<GenogramCanvasRef, Props>(({ data }, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const generateImageBlob = async (): Promise<Blob | null> => {
    if (!svgRef.current) return null;

    const svg = svgRef.current;
    
    // Get actual bounding box of the content
    let bbox = svg.getBBox();
    if (bbox.width === 0 || bbox.height === 0) {
      bbox = { x: 0, y: 0, width: svg.clientWidth, height: svg.clientHeight } as DOMRect;
    }
    const padding = 60; // Add more padding around the content to prevent text cutoff
    const width = bbox.width + padding * 2;
    const height = bbox.height + padding * 2;

    // Clone the SVG node to avoid modifying the DOM
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("class");
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.setAttribute("viewBox", `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);
    clone.setAttribute("width", width.toString());
    clone.setAttribute("height", height.toString());

    // Create a blob from the SVG
    const svgData = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    return new Promise((resolve) => {
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        canvas.width = width * 2; // Higher resolution
        canvas.height = height * 2;
        ctx.scale(2, 2);
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  };

  const downloadPNG = async () => {
    const blob = await generateImageBlob();
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = `가계도_${new Date().toISOString().split('T')[0]}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
  };

  const copyPNG = async (): Promise<boolean> => {
    const blob = await generateImageBlob();
    if (!blob) return false;
    
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);
      return true;
    } catch (err) {
      console.error("Failed to copy image: ", err);
      return false;
    }
  };

  const resetView = () => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        svg.select(".main-group").attr("transform", event.transform);
      });
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
  };

  useImperativeHandle(ref, () => ({
    downloadPNG,
    copyPNG,
    resetView
  }));

  useEffect(() => {
    if (!svgRef.current || !data.members.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const nodesById = new Map(data.members.map(m => [m.id, m]));
    const relationships = data.relationships || [];

    // 1. Calculate generations using relaxation for absolute robustness
    const generations = new Map<string, number>();
    data.members.forEach(m => generations.set(m.id, 0));

    for (let i = 0; i < data.members.length; i++) {
      let changed = false;
      relationships.forEach(r => {
        if (r.type === 'parent-child') {
          const pGen = generations.get(r.from) || 0;
          const cGen = generations.get(r.to) || 0;
          if (cGen < pGen + 1) {
            generations.set(r.to, pGen + 1);
            changed = true;
          }
        } else if (['marriage', 'divorce', 'separation', 'cohabitation'].includes(r.type)) {
          const g1 = generations.get(r.from) || 0;
          const g2 = generations.get(r.to) || 0;
          if (g1 !== g2) {
            const maxG = Math.max(g1, g2);
            generations.set(r.from, maxG);
            generations.set(r.to, maxG);
            changed = true;
          }
        }
      });
      if (!changed) break;
    }

    const minGen = Math.min(...Array.from(generations.values()));
    const maxGen = Math.max(...Array.from(generations.values()));
    const totalGens = maxGen - minGen + 1;
    const genScale = 160;
    const startY = height / 2 - ((totalGens - 1) * genScale) / 2;

    // Prepare links for simulation: map from/to to source/target and filter invalid links
    const marriageLinks = relationships.filter(r => ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type));

    // Group by generation and calculate target X based on birth order / age
    const genGroups = new Map<number, any[]>();
    data.members.forEach(m => {
      const g = generations.get(m.id) || 0;
      if (!genGroups.has(g)) genGroups.set(g, []);
      genGroups.get(g)!.push(m);
    });

    const targetX = new Map<string, number>();
    genGroups.forEach((members, g) => {
      const spacing = 160;
      
      // Build adjacency list for marriages in this generation
      const marriageAdj = new Map<string, string[]>();
      members.forEach(m => marriageAdj.set(m.id, []));
      
      marriageLinks.forEach(l => {
        if (marriageAdj.has(l.from) && marriageAdj.has(l.to)) {
          marriageAdj.get(l.from)!.push(l.to);
          marriageAdj.get(l.to)!.push(l.from);
        }
      });

      // Find connected components (family units)
      const visited = new Set<string>();
      const units: { members: any[], sortValue: number }[] = [];

      members.forEach(m => {
        if (visited.has(m.id)) return;
        
        const unitMembers: any[] = [];
        const q = [m.id];
        visited.add(m.id);
        
        while (q.length > 0) {
          const curr = q.shift()!;
          const node = nodesById.get(curr);
          if (node) unitMembers.push(node);
          
          marriageAdj.get(curr)?.forEach(neighbor => {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              q.push(neighbor);
            }
          });
        }
        
        // Determine unit sort value (prefer birthOrder, then age)
        let bestOrder = Infinity;
        unitMembers.forEach(um => {
          const order = um.birthOrder ?? (um.age ? 1000 - um.age : 500);
          if (order < bestOrder) bestOrder = order;
        });
        
        // Sort within unit: Male first, then Female.
        unitMembers.sort((a, b) => {
          if (a.gender === 'male' && b.gender !== 'male') return -1;
          if (a.gender !== 'male' && b.gender === 'male') return 1;
          const aAge = a.age || 0;
          const bAge = b.age || 0;
          return bAge - aAge;
        });

        units.push({ members: unitMembers, sortValue: bestOrder });
      });

      // Sort units by their sortValue (oldest / lowest birth order first)
      units.sort((a, b) => a.sortValue - b.sortValue);

      // Flatten units back to a sorted list of members
      const sortedMembers = units.flatMap(u => u.members);

      const totalWidth = (sortedMembers.length - 1) * spacing;
      const startX = width / 2 - totalWidth / 2;
      
      sortedMembers.forEach((m, i) => {
        m.fx = startX + i * spacing; // HARDCODE fx to enforce strict horizontal ordering
        targetX.set(m.id, m.fx);
      });
    });

    const simulationLinks = relationships
      .filter(r => r.type !== 'emotional')
      .filter(r => nodesById.has(r.from) && nodesById.has(r.to))
      .map(r => ({ ...r, source: r.from, target: r.to }));

    // Fix Y coordinates to ensure perfect horizontal alignment
    data.members.forEach((m: any) => {
      m.fy = startY + (generations.get(m.id)! - minGen) * genScale;
    });

    const simulation = d3.forceSimulation(data.members as any)
      .force("link", d3.forceLink(simulationLinks).id((d: any) => d.id).distance(120).strength(0.5))
      .force("x", d3.forceX((d: any) => targetX.get(d.id) || width / 2).strength(0.8))
      .force("charge", d3.forceManyBody().strength(-1200))
      .force("collision", d3.forceCollide().radius(80));

    const mainGroup = svg.append("g").attr("class", "main-group");

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        mainGroup.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Initial zoom to fit or at least center
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));

    // Add striped pattern for suspected drug abuse
    const defs = svg.append("defs");
    
    defs.append("pattern")
      .attr("id", "striped")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternTransform", "rotate(45)")
      .append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 8)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Define markers for emotional relationships
    defs.selectAll("marker")
      .data(["very-close", "conflict", "distant", "cutoff", "violence"])
      .enter().append("marker")
      .attr("id", d => `marker-${d}`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", d => d === 'violence' ? 25 : 35)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", d => {
        if (d === 'very-close') return "#10b981";
        if (d === 'conflict' || d === 'violence') return "#ef4444";
        if (d === 'distant') return "#6b7280";
        return "#7c3aed";
      });

    // Draw household boundary
    const boundaryGroup = mainGroup.append("g").attr("class", "household-boundary");

    // Draw links - only for valid relationships
    const validRelationships = relationships.filter(r => nodesById.has(r.from) && nodesById.has(r.to));

    const linkGroup = mainGroup.append("g");
    
    // We'll create multiple lines for 'very-close'
    const link = linkGroup.selectAll(".link")
      .data(validRelationships)
      .enter().append("g")
      .attr("class", "link");

    link.each(function(d: any) {
      const g = d3.select(this);
      
      if (d.type === 'emotional' && (d.emotionalType === 'very-close' || d.emotionalType === 'close')) {
        const offsets = d.emotionalType === 'very-close' ? [-4, 0, 4] : [-3, 3];
        offsets.forEach(offset => {
          g.append("path")
            .attr("class", "main-line")
            .attr("fill", "none")
            .attr("stroke", "#10b981")
            .attr("stroke-width", 1.5)
            .attr("data-offset", offset);
        });
      } else if (d.type === 'emotional' && (d.emotionalType === 'conflict' || d.emotionalType === 'violence')) {
        // Zigzag line
        g.append("path")
          .attr("class", "main-line zigzag-line")
          .attr("fill", "none")
          .attr("stroke", "#ef4444")
          .attr("stroke-width", 2)
          .attr("marker-end", d.emotionalType === 'violence' ? `url(#marker-violence)` : null);
      } else {
        const path = g.append("path")
          .attr("class", "main-line")
          .attr("fill", "none")
          .attr("stroke", () => {
            if (d.type === 'marriage') return "#1e293b";
            if (d.type === 'divorce' || d.type === 'separation') return "#1e293b";
            if (d.type === 'cohabitation') return "#1e293b";
            if (d.type === 'parent-child') return "#4b5563";
            if (d.type === 'emotional') {
              if (d.emotionalType === 'distant') return "#cbd5e1";
              if (d.emotionalType === 'cutoff') return "#7c3aed";
            }
            return "#999";
          })
          .attr("stroke-width", d.type === 'marriage' || d.type === 'divorce' || d.type === 'separation' ? 3 : 2)
          .attr("stroke-dasharray", () => {
            if (d.type === 'cohabitation') return "5,5";
            if (d.type === 'emotional' && d.emotionalType === 'distant') return "2,2";
            const targetNode = nodesById.get(d.to) as any;
            if (d.type === 'parent-child' && targetNode?.isAdopted) return "5,5";
            return "none";
          })
          .attr("marker-end", d.type === 'emotional' && d.emotionalType !== 'cutoff' ? `url(#marker-${d.emotionalType})` : null);

        // Add slashes for divorce/separation
        if (d.type === 'divorce' || d.type === 'separation') {
          const slashCount = d.type === 'divorce' ? 2 : 1;
          for (let i = 0; i < slashCount; i++) {
            g.append("line")
              .attr("class", `slash-${i}`)
              .attr("stroke", "#1e293b")
              .attr("stroke-width", 3)
              .attr("data-index", i);
          }
        }

        // Add identical twin line
        if (d.type === 'twin' && d.twinType === 'identical') {
          g.append("line")
            .attr("class", "twin-identical-line")
            .attr("stroke", "#1e293b")
            .attr("stroke-width", 2);
        }
      }

      // Add text for marriage/divorce year
      if (['marriage', 'divorce', 'separation', 'cohabitation'].includes(d.type)) {
        if (d.marriageYear || d.divorceYear) {
          g.append("text")
            .attr("class", "relationship-year-text text-[10px] font-medium fill-slate-600")
            .attr("text-anchor", "middle")
            .style("paint-order", "stroke")
            .style("stroke", "white")
            .style("stroke-width", "3px")
            .style("stroke-linecap", "round")
            .style("stroke-linejoin", "round");
        }
      }
    });

    // Draw nodes
    const node = mainGroup.append("g")
      .selectAll("g")
      .data(data.members)
      .enter().append("g")
      .call(d3.drag<SVGGElement, any>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    const getShapePath = (d: any) => {
      if (d.gender === 'male') {
        return "M-20,-20 L20,-20 L20,20 L-20,20 Z";
      } else if (d.gender === 'female') {
        return d3.arc()({ innerRadius: 0, outerRadius: 20, startAngle: 0, endAngle: 2 * Math.PI }) || "";
      } else if (d.gender === 'pregnancy') {
        return "M-17.32,15 L17.32,15 L0,-15 Z";
      } else if (d.gender === 'miscarriage') {
        return d3.arc()({ innerRadius: 0, outerRadius: 8, startAngle: 0, endAngle: 2 * Math.PI }) || "";
      } else if (d.gender === 'abortion') {
        return "M-10,-10 L10,10 M10,-10 L-10,10";
      } else {
        return "M0,-25 L20,0 L0,25 L-20,0 Z";
      }
    };

    // Add clip paths for partial fills
    node.append("clipPath")
      .attr("id", d => `clip-${d.id}`)
      .append("path")
      .attr("d", getShapePath);

    // Base shape fill
    node.append("path")
      .attr("d", getShapePath)
      .attr("fill", d => {
        if (d.gender === 'miscarriage') return "#1e293b";
        if (d.gender === 'abortion') return "none";
        if (d.healthStatus === 'illness') return "#94a3b8";
        if (d.healthStatus === 'suspected-drug') return "url(#striped)";
        return "white";
      })
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Partial fills for health status
    node.each(function(d: any) {
      const g = d3.select(this);
      if (['drug-abuse', 'illness-recovery', 'drug-recovery', 'serious-illness-drug'].includes(d.healthStatus)) {
        g.append("rect")
          .attr("clip-path", `url(#clip-${d.id})`)
          .attr("fill", "#1e293b")
          .attr("x", d.healthStatus === 'drug-abuse' || d.healthStatus === 'serious-illness-drug' ? -25 : -25)
          .attr("y", d.healthStatus === 'illness-recovery' || d.healthStatus === 'serious-illness-drug' ? 0 : -25)
          .attr("width", d.healthStatus === 'drug-abuse' || d.healthStatus === 'serious-illness-drug' ? 25 : 50)
          .attr("height", d.healthStatus === 'drug-recovery' || d.healthStatus === 'serious-illness-drug' ? 25 : 50);
      }
    });

    // Inner shape for index member (double border)
    node.filter(d => !!d.isIndexMember)
      .append("path")
      .attr("d", d => {
        if (d.gender === 'male') {
          return "M-14,-14 L14,-14 L14,14 L-14,14 Z";
        } else if (d.gender === 'female') {
          return d3.arc()({
            innerRadius: 0,
            outerRadius: 14,
            startAngle: 0,
            endAngle: 2 * Math.PI
          }) || "";
        } else {
          return "M0,-18 L14,0 L0,18 L-14,0 Z";
        }
      })
      .attr("fill", "none")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Deceased mark (X)
    node.filter(d => !!d.deceased)
      .append("path")
      .attr("d", d => {
        if (d.gender === 'male') {
          return "M-20,-20 L20,20 M20,-20 L-20,20";
        } else if (d.gender === 'female') {
          const offset = 20 * Math.sin(Math.PI / 4);
          return `M${-offset},${-offset} L${offset},${offset} M${offset},${-offset} L${-offset},${offset}`;
        } else {
          return "M-12,-12 L12,12 M12,-12 L-12,12";
        }
      })
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Adopted mark (A)
    node.filter(d => !!d.isAdopted)
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 5)
      .attr("class", "text-[10px] font-bold fill-slate-400")
      .text("A");

    // Labels
    node.append("text")
      .attr("dy", 35)
      .attr("text-anchor", "middle")
      .attr("class", "text-xs font-medium fill-slate-700")
      .style("paint-order", "stroke")
      .style("stroke", "white")
      .style("stroke-width", "3px")
      .style("stroke-linecap", "round")
      .style("stroke-linejoin", "round")
      .text(d => d.name);

    // Description lines (Age, Health, Occupation)
    node.each(function(d: any) {
      const g = d3.select(this);
      
      const filterInvalidText = (text?: string) => {
        if (!text) return '';
        const invalidWords = ['빈칸', '비워둠', '규칙상', '알수없음', '알 수 없음', '모름', '미상', '특이사항없음', '특이사항 없음', '알려진 바 없음', '없음'];
        if (invalidWords.some(word => text.includes(word))) return '';
        if (['양호', '보통', '건강함', '건강'].includes(text)) return '';
        return text.trim();
      };

      const ageStr = d.age ? `${d.age}세` : '';
      const healthStr = filterInvalidText(d.health);
      const occStr = filterInvalidText(d.occupation);
      
      const lines = [ageStr, healthStr, occStr].filter(Boolean);
      
      if (lines.length > 0) {
        const textBlock = g.append("text")
          .attr("text-anchor", "middle")
          .style("paint-order", "stroke")
          .style("stroke", "white")
          .style("stroke-width", "3px")
          .style("stroke-linecap", "round")
          .style("stroke-linejoin", "round");
          
        lines.forEach((line, i) => {
          textBlock.append("tspan")
            .attr("x", 0)
            .attr("dy", i === 0 ? 50 : 14)
            .attr("class", i === 0 ? "text-[10px] font-medium fill-slate-500" : "text-[10px] fill-slate-500")
            .text(line);
        });
      }
    });

    // Death Year
    node.filter(d => !!d.deceased && !!d.deathYear && !['알 수 없음', '모름', '미상'].includes(d.deathYear))
      .append("text")
      .attr("dx", 25)
      .attr("dy", -20)
      .attr("text-anchor", "start")
      .attr("class", "text-[10px] font-bold fill-red-500")
      .style("paint-order", "stroke")
      .style("stroke", "white")
      .style("stroke-width", "3px")
      .style("stroke-linecap", "round")
      .style("stroke-linejoin", "round")
      .text(d => d.deathYear.includes('사망') ? d.deathYear : `${d.deathYear} 사망`);

    // Health Text inside node (e.g., CT, s, O, L)
    node.filter(d => !!d.healthText)
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("class", "text-[12px] font-bold fill-slate-800")
      .text(d => d.healthText);

    simulation.on("tick", () => {
      // Update household boundary
      const livingTogether = data.members.filter(m => m.isLivingTogether) as any[];
      if (livingTogether.length > 0) {
        const padding = 45;
        const minX = d3.min(livingTogether, d => d.x) - padding;
        const maxX = d3.max(livingTogether, d => d.x) + padding;
        const minY = d3.min(livingTogether, d => d.y) - padding;
        const maxY = d3.max(livingTogether, d => d.y) + padding;
        
        const radius = 20;
        const path = `M ${minX + radius} ${minY}
                      H ${maxX - radius}
                      A ${radius} ${radius} 0 0 1 ${maxX} ${minY + radius}
                      V ${maxY - radius}
                      A ${radius} ${radius} 0 0 1 ${maxX - radius} ${maxY}
                      H ${minX + radius}
                      A ${radius} ${radius} 0 0 1 ${minX} ${maxY - radius}
                      V ${minY + radius}
                      A ${radius} ${radius} 0 0 1 ${minX + radius} ${minY} Z`;

        boundaryGroup.selectAll("path")
          .data([path])
          .join("path")
          .attr("d", d => d)
          .attr("fill", "rgba(16, 185, 129, 0.05)")
          .attr("stroke", "rgba(16, 185, 129, 0.4)")
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "8,4");
      } else {
        boundaryGroup.selectAll("path").remove();
      }

      link.each(function(d: any) {
        const g = d3.select(this);
        const source = nodesById.get(d.from) as any;
        const target = nodesById.get(d.to) as any;
        if (!source || !target) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);

        g.selectAll(".main-line").attr("d", function() {
          const offset = parseFloat(d3.select(this).attr("data-offset") || "0");
          
          if (['marriage', 'divorce', 'cohabitation', 'separation'].includes(d.type)) {
            // Marriage line drops down, goes across, goes up
            const midY = Math.max(source.y, target.y) + 40 + offset;
            return `M ${source.x + offset} ${source.y} L ${source.x + offset} ${midY} L ${target.x + offset} ${midY} L ${target.x + offset} ${target.y}`;
          } else if (d.type === 'parent-child') {
            // Parent-child line drops down from the middle of parents, goes across, drops down to child
            let startX = source.x;
            let startY = source.y;
            
            // Find marriage link for this parent to start from the middle
            const otherParentRel = relationships.find(r => r.type === 'parent-child' && r.to === target.id && r.from !== source.id);
            let marriage = null;
            if (otherParentRel) {
              marriage = relationships.find(r => 
                ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
                ((r.from === source.id && r.to === otherParentRel.from) || (r.to === source.id && r.from === otherParentRel.from))
              );
            }
            if (!marriage) {
              marriage = relationships.find(r => 
                ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
                (r.from === source.id || r.to === source.id)
              );
            }
            
          if (marriage) {
            const spouseId = marriage.from === source.id ? marriage.to : marriage.from;
            const spouse = nodesById.get(spouseId) as any;
            if (spouse) {
              // Find the offset of the marriage line to match it
              const marriageLinks = relationships.filter(r => 
                ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
                ((r.from === source.id && r.to === spouse.id) || (r.from === spouse.id && r.to === source.id))
              );
              const mIndex = marriageLinks.findIndex(r => r === marriage);
              const mOffset = (mIndex - (marriageLinks.length - 1) / 2) * 20;
              
              startX = (source.x + spouse.x) / 2 + mOffset;
              startY = Math.max(source.y, spouse.y) + 40 + mOffset; // Match marriage midY
            }
          }
            
            const childMidY = startY + 30; // Drop down from marriage line to create sibling horizontal line
            
            // Check if this child is a twin
            const twinRel = relationships.find(r => r.type === 'twin' && (r.from === target.id || r.to === target.id));
            if (twinRel) {
              const otherTwinId = twinRel.from === target.id ? twinRel.to : twinRel.from;
              const otherTwin = nodesById.get(otherTwinId) as any;
              if (otherTwin) {
                const twinMidX = (target.x + otherTwin.x) / 2;
                return `M ${startX + offset} ${startY} L ${startX + offset} ${childMidY} L ${twinMidX + offset} ${childMidY} L ${target.x + offset} ${target.y - 25}`;
              }
            }
            
            return `M ${startX + offset} ${startY} L ${startX + offset} ${childMidY} L ${target.x + offset} ${childMidY} L ${target.x + offset} ${target.y - 25}`;
          } else if (d.type === 'twin') {
            // We don't draw the main twin line anymore, as it's handled by parent-child
            return "";
          } else if (d.type === 'emotional' && (d.emotionalType === 'conflict' || d.emotionalType === 'violence')) {
            // Straight Zigzag line
            const points = Math.max(6, Math.floor(dist / 10));
            const stepX = dx / points;
            const stepY = dy / points;
            const perpX = -dy / dist;
            const perpY = dx / dist;
            const amp = 6;
            
            let path = `M ${source.x} ${source.y}`;
            for (let i = 1; i < points; i++) {
              const px = source.x + stepX * i + (i % 2 === 0 ? amp : -amp) * perpX;
              const py = source.y + stepY * i + (i % 2 === 0 ? amp : -amp) * perpY;
              path += ` L ${px} ${py}`;
            }
            path += ` L ${target.x} ${target.y}`;
            return path;
          } else if (d.type === 'emotional' && d.emotionalType === 'cutoff') {
            if (dist < 1) return "";
            const gap = 8;
            const barLen = 12;
            
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            
            const dirX = dx / dist;
            const dirY = dy / dist;
            
            const gapStartX = midX - dirX * gap;
            const gapStartY = midY - dirY * gap;
            const gapEndX = midX + dirX * gap;
            const gapEndY = midY + dirY * gap;
            
            const barPerpX = -dirY * barLen;
            const barPerpY = dirX * barLen;
            
            return `M ${source.x} ${source.y} L ${gapStartX} ${gapStartY} 
                    M ${gapStartX + barPerpX} ${gapStartY + barPerpY} L ${gapStartX - barPerpX} ${gapStartY - barPerpY} 
                    M ${gapEndX + barPerpX} ${gapEndY + barPerpY} L ${gapEndX - barPerpX} ${gapEndY - barPerpY} 
                    M ${gapEndX} ${gapEndY} L ${target.x} ${target.y}`;
          } else if (d.type === 'emotional') {
            // Straight line for other emotional types
            const ox = offset * Math.sin(angle);
            const oy = -offset * Math.cos(angle);
            return `M ${source.x + ox} ${source.y + oy} L ${target.x + ox} ${target.y + oy}`;
          } else {
            // Straight line for other types
            const ox = offset * Math.sin(angle);
            const oy = -offset * Math.cos(angle);
            return `M ${source.x + ox} ${source.y + oy} L ${target.x + ox} ${target.y + oy}`;
          }
        });

        // Update slashes
        if (d.type === 'divorce' || d.type === 'separation') {
          const marriageLinks = relationships.filter(r => 
            ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
            ((r.from === source.id && r.to === target.id) || (r.from === target.id && r.to === source.id))
          );
          const mIndex = marriageLinks.findIndex(r => r === d);
          const offset = (mIndex - (marriageLinks.length - 1) / 2) * 20;

          const midX = (source.x + target.x) / 2 + offset;
          const midY = Math.max(source.y, target.y) + 40 + offset; 
          const slashDist = 10;
          
          g.selectAll("[class^='slash-']").each(function() {
            const idx = parseInt(d3.select(this).attr("data-index"));
            const xOffset = (idx - (d.type === 'divorce' ? 0.5 : 0)) * 8;
            
            d3.select(this)
              .attr("x1", midX + xOffset - slashDist * Math.sin(Math.PI/4))
              .attr("y1", midY + slashDist * Math.cos(Math.PI/4))
              .attr("x2", midX + xOffset + slashDist * Math.sin(Math.PI/4))
              .attr("y2", midY - slashDist * Math.cos(Math.PI/4));
          });
        }

        // Update relationship year text position
        if (['marriage', 'divorce', 'separation', 'cohabitation'].includes(d.type)) {
          if (d.marriageYear || d.divorceYear) {
            const marriageLinks = relationships.filter(r => 
              ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
              ((r.from === source.id && r.to === target.id) || (r.from === target.id && r.to === source.id))
            );
            const mIndex = marriageLinks.findIndex(r => r === d);
            const offset = (mIndex - (marriageLinks.length - 1) / 2) * 20;

            const midX = (source.x + target.x) / 2 + offset;
            const midY = Math.max(source.y, target.y) + 40 + offset; 
            
            let text = '';
            if (d.marriageYear) text += `m. ${d.marriageYear} `;
            if (d.divorceYear) text += `d. ${d.divorceYear}`;
            
            g.select(".relationship-year-text")
              .attr("x", midX)
              .attr("y", midY - 8)
              .text(text.trim());
          }
        }

        // Update identical twin line
        if (d.type === 'twin' && d.twinType === 'identical') {
          let parentY = Math.min(source.y, target.y) - 60; // fallback
          const parentChildRel = relationships.find(r => r.type === 'parent-child' && (r.to === source.id || r.to === target.id));
          if (parentChildRel) {
            const parent = nodesById.get(parentChildRel.from) as any;
            if (parent) {
              const marriage = relationships.find(r => 
                ['marriage', 'divorce', 'cohabitation', 'separation'].includes(r.type) &&
                (r.from === parent.id || r.to === parent.id)
              );
              if (marriage) {
                const spouseId = marriage.from === parent.id ? marriage.to : marriage.from;
                const spouse = nodesById.get(spouseId) as any;
                if (spouse) {
                  parentY = Math.max(parent.y, spouse.y) + 30;
                }
              } else {
                parentY = parent.y;
              }
            }
          }
          const splitY = parentY + (Math.min(source.y, target.y) - parentY) / 2;
          const splitX = (source.x + target.x) / 2;
          
          const lineY = Math.min(source.y, target.y) - 25;
          const t = (lineY - splitY) / (source.y - splitY || 1);
          const x1 = splitX + t * (source.x - splitX);
          const x2 = splitX + t * (target.x - splitX);

          g.select(".twin-identical-line")
            .attr("x1", x1)
            .attr("y1", lineY)
            .attr("x2", x2)
            .attr("y2", lineY);
        }
      });

      node
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = startY + (generations.get(event.subject.id)! - minGen) * genScale;
    }

    return () => {
      simulation.stop();
    };
  }, [data]);

  return (
    <div className="w-full h-full bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden relative group">
      <svg ref={svgRef} className="w-full h-full" />

      <div className="absolute bottom-4 left-4 flex flex-col gap-1 text-[10px] text-slate-500 bg-white/80 p-2 rounded-lg border border-slate-100 max-h-[150px] overflow-y-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-3 h-3 bg-white border border-slate-800"></div> 남/여/미상
          <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-slate-800 ml-2"></div> 임신
          <div className="w-2 h-2 bg-slate-800 rounded-full ml-2"></div> 유산
          <div className="relative w-3 h-3 ml-2"><div className="absolute w-full h-px bg-slate-800 top-1/2 -translate-y-1/2 rotate-45"></div><div className="absolute w-full h-px bg-slate-800 top-1/2 -translate-y-1/2 -rotate-45"></div></div> 낙태
          <div className="w-3 h-3 bg-white border border-slate-800 relative flex items-center justify-center ml-2"><div className="w-1.5 h-1.5 border border-slate-800"></div></div> 중심인물
          <div className="w-3 h-3 bg-white border border-slate-800 relative flex items-center justify-center ml-2">
            <div className="absolute w-full h-px bg-slate-800 rotate-45"></div>
            <div className="absolute w-full h-px bg-slate-800 -rotate-45"></div>
          </div> 사망
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <div className="w-3 h-3 bg-slate-400 border border-slate-800"></div> 질병
          <div className="w-3 h-3 bg-white border border-slate-800 relative overflow-hidden ml-2"><div className="absolute left-0 top-0 w-1/2 h-full bg-slate-800"></div></div> 약물남용
          <div className="w-3 h-3 bg-white border border-slate-800 relative overflow-hidden ml-2"><div className="absolute left-0 bottom-0 w-full h-1/2 bg-slate-800"></div></div> 질병회복
          <div className="w-3 h-3 bg-white border border-slate-800 relative overflow-hidden ml-2"><div className="absolute left-0 top-0 w-full h-1/2 bg-slate-800"></div></div> 약물회복
          <div className="w-3 h-3 bg-white border border-slate-800 relative overflow-hidden ml-2"><div className="absolute left-0 bottom-0 w-1/2 h-1/2 bg-slate-800"></div></div> 심각한질병+약물
          <div className="w-3 h-3 bg-white border border-slate-800 relative overflow-hidden ml-2" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 1px, #1e293b 1px, #1e293b 2px)'}}></div> 약물의심
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <div className="w-3 h-0.5 bg-slate-800"></div> 혼인
          <div className="relative w-4 h-0.5 bg-slate-800 ml-2">
            <div className="absolute top-1/2 left-1/2 w-px h-2.5 bg-slate-800 -translate-x-[2px] -translate-y-1/2 rotate-45"></div>
            <div className="absolute top-1/2 left-1/2 w-px h-2.5 bg-slate-800 translate-x-[2px] -translate-y-1/2 rotate-45"></div>
          </div> 이혼
          <div className="w-4 h-0.5 border-t border-dashed border-slate-800 ml-2"></div> 동거
          <div className="w-3 h-3 border-t border-l border-slate-800 rotate-45 ml-2 translate-y-1"></div> 쌍둥이
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <div className="w-3 h-1 border-y border-emerald-500"></div> 친밀
          <div className="w-3 h-1.5 border-y border-emerald-500 relative"><div className="absolute top-1/2 left-0 w-full h-px bg-emerald-500 -translate-y-1/2"></div></div> 밀착
          <svg className="w-3 h-2 ml-2" viewBox="0 0 12 8" fill="none" stroke="#ef4444" strokeWidth="1.5">
            <path d="M0,4 L3,0 L6,8 L9,0 L12,4" />
          </svg> 갈등
          <div className="w-3 h-0.5 border-t border-dashed border-slate-400 ml-2"></div> 소원
          <div className="flex items-center ml-2">
            <div className="w-1.5 h-0.5 bg-purple-600"></div>
            <div className="h-2 w-px bg-purple-600"></div>
            <div className="w-1 h-0"></div>
            <div className="h-2 w-px bg-purple-600"></div>
            <div className="w-1.5 h-0.5 bg-purple-600"></div>
          </div> 단절
        </div>
      </div>
    </div>
  );
});
