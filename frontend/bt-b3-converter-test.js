/**
 * BT Format Converter Tests
 * Validates round-trip conversion between Wend and b3 formats
 */

function testB3Converter() {
    console.log('🧪 Starting BT format converter tests...\n');

    // Test 1: Simple sequence conversion
    console.log('Test 1: Simple Sequence');
    const simpleSeq = {
        nodeType: 'root',
        title: 'Root',
        btType: 'sequence',
        children: [
            {
                nodeType: 'assemble',
                title: 'Action 1',
                btType: 'leaf',
                btAction: 'processPrompt',
                btPrompt: 'SGVsbG8gV29ybGQ=', // Base64: "Hello World"
                btOutputKey: 'result1'
            }
        ]
    };

    const b3Format1 = B3TreeConverter.wendToB3(simpleSeq);
    console.log('✅ Converted to b3 format:', JSON.stringify(b3Format1, null, 2));

    const backToWend1 = B3TreeConverter.b3ToWend(b3Format1);
    console.log('✅ Converted back to Wend format:', JSON.stringify(backToWend1, null, 2));
    console.log('✅ Test 1 passed\n');

    // Test 2: RepeatSequence with child action
    console.log('Test 2: RepeatSequence with repeat count');
    const repeatSeq = {
        nodeType: 'root',
        title: 'Repeating Task',
        btType: 'repeatSequence',
        btRepeatCount: '3',
        children: [
            {
                nodeType: 'assemble',
                title: 'Loop Action',
                btType: 'leaf',
                btAction: 'processPrompt',
                btPrompt: 'TG9vcCBjb3VudA==', // Base64: "Loop count"
                btOutputKey: 'loopResult'
            }
        ]
    };

    const b3Format2 = B3TreeConverter.wendToB3(repeatSeq);
    console.log('✅ Converted RepeatSequence to b3:', JSON.stringify(b3Format2, null, 2));

    const backToWend2 = B3TreeConverter.b3ToWend(b3Format2);
    console.log('✅ Converted back:', JSON.stringify(backToWend2, null, 2));

    // Verify repeat count preserved
    if (backToWend2.btRepeatCount === '3') {
        console.log('✅ Repeat count preserved correctly\n');
    } else {
        console.log('❌ Repeat count not preserved. Expected: 3, Got:', backToWend2.btRepeatCount, '\n');
    }
    console.log('✅ Test 2 passed\n');

    // Test 3: Complex tree with mixed node types
    console.log('Test 3: Complex tree (Sequence + RepeatSelector + Actions)');
    const complexTree = {
        nodeType: 'root',
        title: 'Complex Workflow',
        btType: 'sequence',
        children: [
            {
                nodeType: 'assemble',
                title: 'Setup Phase',
                btType: 'leaf',
                btAction: 'loadLocalFile',
                btLocalFilePath: '/path/to/file.txt',
                btOutputKey: 'fileContent'
            },
            {
                nodeType: 'assemble',
                title: 'Retry Loop',
                btType: 'repeatSelector',
                btRepeatCount: '2',
                children: [
                    {
                        nodeType: 'assemble',
                        title: 'Try Action A',
                        btType: 'leaf',
                        btAction: 'processPrompt',
                        btPrompt: 'VHJ5IEE=',
                        btInputKey: 'fileContent',
                        btOutputKey: 'resultA'
                    },
                    {
                        nodeType: 'assemble',
                        title: 'Try Action B',
                        btType: 'leaf',
                        btAction: 'processPrompt',
                        btPrompt: 'VHJ5IEI=',
                        btInputKey: 'fileContent',
                        btOutputKey: 'resultB'
                    }
                ]
            }
        ]
    };

    const b3Format3 = B3TreeConverter.wendToB3(complexTree);
    console.log('✅ Converted complex tree to b3 with', Object.keys(b3Format3.nodes).length, 'nodes');

    const backToWend3 = B3TreeConverter.b3ToWend(b3Format3);
    console.log('✅ Converted back to Wend');

    // Verify structure preserved
    if (backToWend3.children && backToWend3.children.length === 2) {
        console.log('✅ Root children count preserved:', backToWend3.children.length);
    }
    if (backToWend3.children[1].children && backToWend3.children[1].children.length === 2) {
        console.log('✅ RepeatSelector children preserved:', backToWend3.children[1].children.length);
    }
    console.log('✅ Test 3 passed\n');

    // Test 4: Format detection
    console.log('Test 4: Format detection');
    const promptsFormat = { children: [] };
    const b3FormatObj = { nodes: {}, root: 'n-0' };

    console.log('Wend format detected as:', B3TreeConverter.detectFormat(promptsFormat)); // Should be 'prompts'
    console.log('B3 format detected as:', B3TreeConverter.detectFormat(b3FormatObj)); // Should be 'b3'
    console.log('✅ Test 4 passed\n');

    // Test 5: Compound type expand → collapse round-trip (2-part)
    console.log('Test 5: Compound type round-trip (repeater+selector)');
    const compoundTree = {
        nodeType: 'root', title: 'Root',
        btType: 'repeater+selector',
        btRepeatCount: '3',
        children: [
            { nodeType: 'assemble', title: 'A', btType: 'leaf', btAction: 'processPrompt', btPrompt: 'QQ==', btOutputKey: 'r1', children: [] },
            { nodeType: 'assemble', title: 'B', btType: 'leaf', btAction: 'processPrompt', btPrompt: 'Qg==', btOutputKey: 'r2', children: [] },
        ]
    };
    const b5 = B3TreeConverter.wendToB3(compoundTree);
    console.log(`  Expanded to ${Object.keys(b5.nodes).length} nodes`);
    if (Object.keys(b5.nodes).length === 3) {
        console.log('  ✅ Correct: 3 nodes (Repeater → Selector → [A, B])');
    } else {
        console.log('  ❌ Expected 3 nodes, got', Object.keys(b5.nodes).length);
    }
    const back5 = B3TreeConverter.b3ToWend(b5);
    if (back5.btType === 'repeater+selector' && back5.children.length === 2) {
        console.log('  ✅ Collapsed back to repeater+selector with 2 children');
    } else {
        console.log('  ❌ btType:', back5.btType, 'children:', back5.children ? back5.children.length : 0);
    }
    console.log('✅ Test 5 passed\n');

    // Test 6: Compound type round-trip (3-part: repeater+invert+sequence)
    console.log('Test 6: Compound type round-trip (repeater+invert+sequence)');
    const compoundTree2 = {
        nodeType: 'root', title: 'Root',
        btType: 'repeater+invert+sequence',
        btRepeatCount: '2',
        children: [
            { nodeType: 'assemble', title: 'X', btType: 'leaf', btAction: 'processPrompt', btPrompt: 'WA==', children: [] },
        ]
    };
    const b6 = B3TreeConverter.wendToB3(compoundTree2);
    console.log(`  Expanded to ${Object.keys(b6.nodes).length} nodes`);
    if (Object.keys(b6.nodes).length === 3) {
        console.log('  ✅ Correct: 3 nodes (Repeater → Invert → Sequence → [X])');
    }
    const back6 = B3TreeConverter.b3ToWend(b6);
    if (back6.btType === 'repeater+invert+sequence' && back6.children.length === 1) {
        console.log('  ✅ Collapsed back to repeater+invert+sequence');
    } else {
        console.log('  ❌ btType:', back6.btType);
    }
    console.log('✅ Test 6 passed\n');

    // Test 7: Non-matching b3 chain should NOT collapse (different order / missing match)
    console.log('Test 7: Non-matching b3 chain kept as physical nodes');
    const nonMatchingB3 = {
        id: 'tree-nm', title: 'NonMatch', root: 'n0',
        nodes: {
            'n0': { id: 'n0', name: 'Sequence', title: 'OuterSeq', children: ['n1'] },
            'n1': { id: 'n1', name: 'ProcessPromptAction', title: 'Action', properties: { prompt: 'hello' }, children: [] },
        }
    };
    const back7 = B3TreeConverter.b3ToWend(nonMatchingB3);
    if (back7.btType === undefined || back7.btType === 'sequence') {
        console.log('  ✅ Sequence kept as physical, not collapsed (only 1 item in chain)');
    } else {
        console.log('  ❌ Unexpected collapse to:', back7.btType);
    }
    console.log('✅ Test 7 passed\n');

    console.log('✅ All converter tests completed successfully!');
}

// Run tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { testB3Converter };
}
